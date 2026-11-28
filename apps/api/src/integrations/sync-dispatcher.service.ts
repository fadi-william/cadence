import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DelayedError, Job, Queue, Worker } from 'bullmq';
import { CronJob } from 'cron';
import { Redis } from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { DateRange } from './adapters/adapter.types';
import { SyncService, SyncTrigger } from './sync.service';
import type { SyncRun } from '../generated/prisma/client';

const QUEUE = 'cadence-sync';
/** Expiry of the per-connection Redis lock, so a crashed worker cannot block a connection for good. */
const LOCK_TTL_MS = 2 * 60 * 60 * 1000;
/** How long a sync waits before retrying when its connection is already syncing. */
const LOCK_RETRY_MS = 30_000;

/**
 * Widens the pending debounce range stored at `KEYS[1]` to include [`ARGV[1]`, `ARGV[2]`] (epoch ms) and
 * returns the merged `{from, to}`. Atomic, so concurrent webhooks can't overwrite each other's days.
 * `ARGV[3]` is the key's expiry in ms.
 */
const MERGE_RANGE_SCRIPT = `
local from = tonumber(redis.call('HGET', KEYS[1], 'from') or ARGV[1])
local to = tonumber(redis.call('HGET', KEYS[1], 'to') or ARGV[2])
from = math.min(from, tonumber(ARGV[1]))
to = math.max(to, tonumber(ARGV[2]))
redis.call('HSET', KEYS[1], 'from', from, 'to', to)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return {tostring(from), tostring(to)}
`;

/** Returns the pending range stored at `KEYS[1]` (or nothing) and deletes it, atomically. */
const TAKE_RANGE_SCRIPT = `
local range = redis.call('HMGET', KEYS[1], 'from', 'to')
redis.call('DEL', KEYS[1])
return range
`;

const debounceKey = (connectionId: string) => `debounce:${connectionId}`;
const pendingRangeKey = (connectionId: string) => `cadence:debounce-range:${connectionId}`;

/** Payload of a `sync` job (queue mode) or of an inline run. */
interface SyncJobData {
  /** Run to execute. Absent on debounced jobs: the worker creates the run when the job starts. */
  runId?: string;
  connectionId: string;
  /** ISO timestamp of the range's first day. */
  from: string;
  /** ISO timestamp of the range's last day (inclusive). */
  to: string;
  trigger: SyncTrigger;
}

/**
 * Decides *how* syncs run.
 *  - `REDIS_URL` set  → BullMQ queue + worker(s); nightly schedule is a BullMQ job scheduler (fires once
 *                       across all API instances); a Redis lock serialises syncs per connection.
 *  - no `REDIS_URL`   → in-process execution with an in-memory lock and a local cron.
 * Set `SYNC_WORKER=false` on API instances that should only enqueue (dedicated worker deployment).
 *
 * The nightly schedule (`SYNC_CRON`, default `0 2 * * *`; `off` disables it) re-syncs the last 2 days
 * of every enabled connection. `SYNC_CONCURRENCY` (default 2) sets how many jobs each worker runs at once.
 */
@Injectable()
export class SyncDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncDispatcher.name);
  private queue?: Queue<SyncJobData>;
  private worker?: Worker<SyncJobData>;
  private redis?: Redis;
  private readonly localLocks = new Set<string>();
  private readonly debounce = new Map<string, { timer: NodeJS.Timeout; range: DateRange }>();

  constructor(
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** `queue` when backed by BullMQ (`REDIS_URL` set), `inline` when syncs run in this process. */
  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  /** Sets up the queue, worker and job scheduler (queue mode), or the local cron job (inline mode). */
  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    const cron = this.config.get<string>('SYNC_CRON', '0 2 * * *');
    if (url) {
      const connection = { url, maxRetriesPerRequest: null };
      this.queue = new Queue<SyncJobData>(QUEUE, {
        connection,
        defaultJobOptions: { removeOnComplete: { count: 500 }, removeOnFail: { count: 500 } },
      });
      this.redis = new Redis(url, { maxRetriesPerRequest: null });
      if (this.config.get('SYNC_WORKER', 'true') !== 'false') {
        this.worker = new Worker<SyncJobData>(QUEUE, (job, token) => this.process(job, token), {
          connection,
          concurrency: Number(this.config.get('SYNC_CONCURRENCY', 2)),
        });
        this.worker.on('failed', (job, err) => this.logger.warn(`Sync job ${job?.id} failed: ${err.message}`));
      }
      if (cron !== 'off') {
        await this.queue.upsertJobScheduler('nightly-sync', { pattern: cron }, { name: 'sync-all' });
      } else {
        await this.queue.removeJobScheduler('nightly-sync');
      }
      this.logger.log(`Sync queue ready (BullMQ, worker=${!!this.worker}, schedule=${cron})`);
    } else if (cron !== 'off') {
      const job = CronJob.from({
        cronTime: cron,
        onTick: () => this.background(this.enqueueAll(2), 'Nightly sync'),
        start: true,
      });
      this.scheduler.addCronJob('nightly-sync', job);
      this.logger.log(`Sync running in-process (no REDIS_URL); nightly schedule ${cron}`);
    }
  }

  async onModuleDestroy() {
    for (const { timer } of this.debounce.values()) clearTimeout(timer);
    await this.worker?.close();
    await this.queue?.close();
    this.redis?.disconnect();
  }

  /**
   * Queues a sync for every enabled connection (nightly).
   *
   * @param days - Days to re-sync, ending today.
   */
  async enqueueAll(days: number) {
    const connections = await this.prisma.integrationConnection.findMany({ where: { enabled: true } });
    for (const c of connections) await this.enqueue(c.id, this.sync.rangeForDays(days), 'schedule');
  }

  /**
   * Creates a QUEUED run and schedules it. Returns immediately; poll the run for completion.
   *
   * In inline mode the run starts on the next tick; if the connection is already syncing it waits and
   * retries every 30 s. In queue mode the run waits for a worker, so it stays QUEUED while no instance
   * runs one.
   */
  async enqueue(connectionId: string, range: DateRange, trigger: SyncTrigger): Promise<SyncRun> {
    const run = await this.sync.createRun(connectionId, range, trigger);
    const data: SyncJobData = {
      runId: run.id,
      connectionId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      trigger,
    };
    if (this.queue) await this.queue.add('sync', data, { jobId: `run-${run.id}` });
    else setImmediate(() => this.background(this.runInline(data), `Sync of connection ${connectionId}`));
    return run;
  }

  /**
   * Coalesces bursts (e.g. webhooks) into one sync per connection after `delayMs` of quiet. No run is
   * recorded until the delay has passed.
   *
   * Both modes sync the union of the ranges of all events in the window. Inline mode keeps the pending
   * range in memory. Queue mode keeps it in Redis (merged atomically) and uses BullMQ deduplication with
   * `replace`, so the delayed job always carries the widest range seen so far.
   */
  async enqueueDebounced(connectionId: string, range: DateRange, trigger: SyncTrigger, delayMs: number) {
    if (this.queue) {
      const merged = await this.mergePendingRange(connectionId, range);
      await this.queue.add(
        'sync',
        { connectionId, from: merged.from.toISOString(), to: merged.to.toISOString(), trigger },
        {
          delay: delayMs,
          deduplication: { id: debounceKey(connectionId), ttl: delayMs, extend: true, replace: true },
        },
      );
      return;
    }
    const pending = this.debounce.get(connectionId);
    const merged = pending
      ? {
          from: new Date(Math.min(pending.range.from.getTime(), range.from.getTime())),
          to: new Date(Math.max(pending.range.to.getTime(), range.to.getTime())),
        }
      : range;
    if (pending) clearTimeout(pending.timer);
    const timer = setTimeout(() => {
      this.debounce.delete(connectionId);
      this.background(this.enqueue(connectionId, merged, trigger), `Debounced sync of connection ${connectionId}`);
    }, delayMs);
    timer.unref?.();
    this.debounce.set(connectionId, { timer, range: merged });
  }

  /** Widens the connection's pending debounce range in Redis to include `range` and returns the result. */
  private async mergePendingRange(connectionId: string, range: DateRange): Promise<DateRange> {
    const [from, to] = (await this.redis!.eval(
      MERGE_RANGE_SCRIPT,
      1,
      pendingRangeKey(connectionId),
      range.from.getTime(),
      range.to.getTime(),
      LOCK_TTL_MS,
    )) as [string, string];
    return { from: new Date(Number(from)), to: new Date(Number(to)) };
  }

  /**
   * Claims the debounced range for a job that is about to run: merges in any range stored after the job was
   * queued (events BullMQ ignored because the job had left the delayed state) and clears both the stored
   * range and the deduplication key, so events arriving during this sync schedule a follow-up job.
   */
  private async claimDebouncedRange(data: SyncJobData): Promise<DateRange> {
    const [from, to] = (await this.redis!.eval(TAKE_RANGE_SCRIPT, 1, pendingRangeKey(data.connectionId))) as [
      string | null,
      string | null,
    ];
    await this.queue!.removeDeduplicationKey(debounceKey(data.connectionId));
    return {
      from: new Date(Math.min(new Date(data.from).getTime(), from === null ? Infinity : Number(from))),
      to: new Date(Math.max(new Date(data.to).getTime(), to === null ? -Infinity : Number(to))),
    };
  }

  // ---------- execution ----------

  /** Runs work nobody awaits (timers, cron ticks) and logs a failure instead of letting it crash the process. */
  private background(work: Promise<unknown>, what: string) {
    work.catch((e: unknown) => this.logger.error(`${what} failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  /** Executes a run in-process, serialised per connection by an in-memory lock (retried every 30 s). */
  private async runInline(data: SyncJobData) {
    if (this.localLocks.has(data.connectionId)) {
      setTimeout(
        () => this.background(this.runInline(data), `Sync of connection ${data.connectionId}`),
        LOCK_RETRY_MS,
      ).unref?.();
      return;
    }
    this.localLocks.add(data.connectionId);
    try {
      await this.sync.execute(data.runId!);
    } catch (e) {
      await this.sync.markFailed(data.runId!, (e as Error).message);
    } finally {
      this.localLocks.delete(data.connectionId);
    }
  }

  /**
   * BullMQ worker handler. `sync-all` jobs (the nightly scheduler) fan out to one job per connection; `sync`
   * jobs take the per-connection Redis lock, creating the run first for debounced jobs. When the lock is
   * held the job is moved back to delayed for 30 s, which BullMQ does not count as a failure.
   */
  private async process(job: Job<SyncJobData>, token?: string) {
    if (job.name === 'sync-all') {
      await this.enqueueAll(2);
      return;
    }
    const lockKey = `cadence:sync-lock:${job.data.connectionId}`;
    const acquired = await this.redis!.set(lockKey, job.id ?? '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired) {
      await job.moveToDelayed(Date.now() + LOCK_RETRY_MS, token);
      throw new DelayedError();
    }
    try {
      let runId = job.data.runId;
      if (!runId) {
        // Only debounced jobs arrive without a run.
        const range = await this.claimDebouncedRange(job.data);
        const run = await this.sync.createRun(job.data.connectionId, range, job.data.trigger);
        runId = run.id;
        await job.updateData({
          ...job.data,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          runId,
        });
      }
      const run = await this.sync.execute(runId);
      return { status: run?.status, recordsWritten: run?.recordsWritten };
    } finally {
      // Only release our own lock.
      if ((await this.redis!.get(lockKey)) === (job.id ?? '1')) await this.redis!.del(lockKey);
    }
  }
}
