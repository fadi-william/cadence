import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';
import { SyncDispatcher } from './sync-dispatcher.service';
import type { SyncService } from './sync.service';
import type { PrismaService } from '../common/prisma/prisma.service';

const mocks = vi.hoisted(() => {
  const queue = {
    add: vi.fn(),
    upsertJobScheduler: vi.fn(),
    removeJobScheduler: vi.fn(),
    removeDeduplicationKey: vi.fn(),
    close: vi.fn(),
  };
  const worker = { on: vi.fn(), close: vi.fn() };
  const redis = { set: vi.fn(), get: vi.fn(), del: vi.fn(), eval: vi.fn(), disconnect: vi.fn() };
  return {
    queue,
    worker,
    redis,
    Queue: vi.fn(function () {
      return queue;
    }),
    Worker: vi.fn(function () {
      return worker;
    }),
    Redis: vi.fn(function () {
      return redis;
    }),
  };
});

vi.mock('bullmq', () => ({
  Queue: mocks.Queue,
  Worker: mocks.Worker,
  DelayedError: class DelayedError extends Error {},
}));
vi.mock('ioredis', () => ({ Redis: mocks.Redis }));

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const range = { from: D('2026-11-01'), to: D('2026-11-02') };

describe('SyncDispatcher', () => {
  const sync = { createRun: vi.fn(), execute: vi.fn(), markFailed: vi.fn(), rangeForDays: vi.fn() };
  const prisma = { integrationConnection: { findMany: vi.fn() } };
  const scheduler = { addCronJob: vi.fn() };
  let values: Record<string, string>;
  const make = () =>
    new SyncDispatcher(
      sync as unknown as SyncService,
      prisma as unknown as PrismaService,
      { get: (k: string, d?: string) => values[k] ?? d } as unknown as ConfigService,
      scheduler as unknown as SchedulerRegistry,
    );
  let runSeq = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    values = {};
    runSeq = 0;
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    sync.createRun.mockImplementation(async (connectionId: string, r: typeof range, trigger: string) => ({
      id: `run-${++runSeq}`,
      connectionId,
      rangeFrom: r.from,
      rangeTo: r.to,
      trigger,
    }));
    sync.execute.mockResolvedValue({ status: 'SUCCESS', recordsWritten: 3 });
    sync.rangeForDays.mockReturnValue(range);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('inline mode (no REDIS_URL)', () => {
    it('registers a local nightly cron unless disabled', async () => {
      const d = make();
      await d.onModuleInit();
      expect(d.mode).toBe('inline');
      expect(scheduler.addCronJob).toHaveBeenCalledWith('nightly-sync', expect.anything());
      const job = scheduler.addCronJob.mock.calls[0][1] as CronJob;
      expect(job.isActive).toBe(true);
      void job.stop();

      values.SYNC_CRON = 'off';
      await make().onModuleInit();
      expect(scheduler.addCronJob).toHaveBeenCalledTimes(1);
      expect(mocks.Queue).not.toHaveBeenCalled();
    });

    it('enqueue creates the run, returns it immediately and executes it in the background', async () => {
      const d = make();
      const run = await d.enqueue('c1', range, 'manual');
      expect(run.id).toBe('run-1');
      expect(sync.createRun).toHaveBeenCalledWith('c1', range, 'manual');
      expect(sync.execute).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(sync.execute).toHaveBeenCalledWith('run-1'));
    });

    it('marks the run failed when execution throws', async () => {
      sync.execute.mockRejectedValue(new Error('boom'));
      await make().enqueue('c1', range, 'manual');
      await vi.waitFor(() => expect(sync.markFailed).toHaveBeenCalledWith('run-1', 'boom'));
    });

    it('serialises runs per connection and retries a locked one later', async () => {
      vi.useFakeTimers();
      let finish!: () => void;
      sync.execute.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
      const d = make();
      await d.enqueue('c1', range, 'manual');
      await vi.advanceTimersByTimeAsync(0);
      await d.enqueue('c1', range, 'manual');
      await d.enqueue('c2', range, 'manual');
      await vi.advanceTimersByTimeAsync(0);
      expect(sync.execute.mock.calls.map((c) => c[0])).toEqual(['run-1', 'run-3']);

      finish();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(sync.execute).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(sync.execute.mock.calls.map((c) => c[0])).toEqual(['run-1', 'run-3', 'run-2']);
    });

    it('enqueueDebounced coalesces bursts into one run spanning the merged range', async () => {
      vi.useFakeTimers();
      const d = make();
      await d.enqueueDebounced('c1', { from: D('2026-11-05'), to: D('2026-11-06') }, 'webhook', 1000);
      await vi.advanceTimersByTimeAsync(900);
      await d.enqueueDebounced('c1', { from: D('2026-11-03'), to: D('2026-11-04') }, 'webhook', 1000);
      await vi.advanceTimersByTimeAsync(900);
      expect(sync.createRun).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(sync.createRun).toHaveBeenCalledTimes(1);
      expect(sync.createRun).toHaveBeenCalledWith('c1', { from: D('2026-11-03'), to: D('2026-11-06') }, 'webhook');

      // A later burst starts fresh rather than reusing the old range.
      await d.enqueueDebounced('c1', range, 'webhook', 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(sync.createRun).toHaveBeenLastCalledWith('c1', range, 'webhook');
    });

    it('debounces each connection independently', async () => {
      vi.useFakeTimers();
      const d = make();
      await d.enqueueDebounced('c1', range, 'webhook', 1000);
      await d.enqueueDebounced('c2', range, 'webhook', 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(sync.createRun.mock.calls.map((c) => c[0]).sort()).toEqual(['c1', 'c2']);
    });

    it('logs instead of crashing when a debounced sync cannot be created', async () => {
      vi.useFakeTimers();
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      // e.g. the connection was deleted while the webhook burst was debouncing.
      sync.createRun.mockRejectedValueOnce(new Error('connection not found'));
      await make().enqueueDebounced('c1', range, 'webhook', 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(error).toHaveBeenCalledWith('Debounced sync of connection c1 failed: connection not found');
    });

    it('logs instead of crashing when a failed run cannot be marked failed', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      sync.execute.mockRejectedValue(new Error('boom'));
      sync.markFailed.mockRejectedValueOnce(new Error('run not found'));
      await make().enqueue('c1', range, 'manual');
      await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Sync of connection c1 failed: run not found'));
    });

    it('onModuleDestroy cancels pending debounced syncs', async () => {
      vi.useFakeTimers();
      const d = make();
      await d.enqueueDebounced('c1', range, 'webhook', 1000);
      await d.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(5000);
      expect(sync.createRun).not.toHaveBeenCalled();
    });

    it('enqueueAll schedules every enabled connection', async () => {
      prisma.integrationConnection.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      await make().enqueueAll(2);
      expect(prisma.integrationConnection.findMany).toHaveBeenCalledWith({ where: { enabled: true } });
      expect(sync.rangeForDays).toHaveBeenCalledWith(2);
      expect(sync.createRun.mock.calls).toEqual([
        ['c1', range, 'schedule'],
        ['c2', range, 'schedule'],
      ]);
      // Let the inline runs finish so they don't leak into the next test.
      await vi.waitFor(() => expect(sync.execute).toHaveBeenCalledTimes(2));
    });
  });

  describe('queue mode (REDIS_URL)', () => {
    type Processor = (job: unknown, token?: string) => Promise<unknown>;
    const init = async (extra: Record<string, string> = {}) => {
      values = { REDIS_URL: 'redis://r:6379', ...extra };
      const d = make();
      await d.onModuleInit();
      return d;
    };
    const processor = () => (mocks.Worker.mock.calls[0] as unknown[])[1] as Processor;
    /** In-memory stand-in for the two Lua scripts that keep the pending debounce range in Redis. */
    let pending: Map<string, { from: number; to: number }>;
    beforeEach(() => {
      pending = new Map();
      mocks.redis.eval.mockImplementation(async (_script: string, _keys: number, key: string, ...args: number[]) => {
        const stored = pending.get(key);
        if (args.length === 0) {
          pending.delete(key);
          return stored ? [String(stored.from), String(stored.to)] : [null, null];
        }
        const merged = {
          from: Math.min(stored?.from ?? args[0], args[0]),
          to: Math.max(stored?.to ?? args[1], args[1]),
        };
        pending.set(key, merged);
        return [String(merged.from), String(merged.to)];
      });
    });
    const job = (data: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
      id: 'job-1',
      name: 'sync',
      data: {
        connectionId: 'c1',
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        trigger: 'webhook',
        ...data,
      },
      moveToDelayed: vi.fn(),
      updateData: vi.fn(),
      ...over,
    });

    it('creates queue, worker and nightly scheduler', async () => {
      const d = await init({ SYNC_CONCURRENCY: '4' });
      expect(d.mode).toBe('queue');
      expect(mocks.Queue).toHaveBeenCalledWith(
        'cadence-sync',
        expect.objectContaining({ connection: expect.objectContaining({ url: 'redis://r:6379' }) }),
      );
      expect(mocks.Worker).toHaveBeenCalledWith(
        'cadence-sync',
        expect.any(Function),
        expect.objectContaining({ concurrency: 4 }),
      );
      expect(mocks.queue.upsertJobScheduler).toHaveBeenCalledWith(
        'nightly-sync',
        { pattern: '0 2 * * *' },
        { name: 'sync-all' },
      );
      expect(scheduler.addCronJob).not.toHaveBeenCalled();
    });

    it('can run enqueue-only (no worker) and remove the schedule', async () => {
      await init({ SYNC_WORKER: 'false', SYNC_CRON: 'off' });
      expect(mocks.Worker).not.toHaveBeenCalled();
      expect(mocks.queue.removeJobScheduler).toHaveBeenCalledWith('nightly-sync');
      expect(mocks.queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('enqueue adds a job keyed by run id and does not execute inline', async () => {
      const d = await init();
      await d.enqueue('c1', range, 'manual');
      expect(mocks.queue.add).toHaveBeenCalledWith(
        'sync',
        {
          runId: 'run-1',
          connectionId: 'c1',
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          trigger: 'manual',
        },
        { jobId: 'run-run-1' },
      );
      await new Promise((r) => setImmediate(r));
      expect(sync.execute).not.toHaveBeenCalled();
    });

    it('enqueueDebounced uses BullMQ deduplication without creating a run up front', async () => {
      const d = await init();
      await d.enqueueDebounced('c1', range, 'webhook', 5000);
      expect(sync.createRun).not.toHaveBeenCalled();
      expect(mocks.redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'cadence:debounce-range:c1',
        range.from.getTime(),
        range.to.getTime(),
        7_200_000,
      );
      expect(mocks.queue.add).toHaveBeenCalledWith(
        'sync',
        { connectionId: 'c1', from: range.from.toISOString(), to: range.to.toISOString(), trigger: 'webhook' },
        { delay: 5000, deduplication: { id: 'debounce:c1', ttl: 5000, extend: true, replace: true } },
      );
    });

    it('enqueueDebounced replaces the job with the union of every range in the burst', async () => {
      const d = await init();
      await d.enqueueDebounced('c1', { from: D('2026-11-10'), to: D('2026-11-11') }, 'webhook', 5000);
      await d.enqueueDebounced('c1', { from: D('2026-11-26'), to: D('2026-11-27') }, 'webhook', 5000);
      expect(mocks.queue.add).toHaveBeenLastCalledWith(
        'sync',
        expect.objectContaining({ from: D('2026-11-10').toISOString(), to: D('2026-11-27').toISOString() }),
        expect.anything(),
      );
    });

    it('processes a debounced job: takes the lock, creates the run, executes and releases', async () => {
      await init();
      mocks.redis.set.mockResolvedValue('OK');
      mocks.redis.get.mockResolvedValue('job-1');
      const j = job({});
      await expect(processor()(j, 'tok')).resolves.toEqual({ status: 'SUCCESS', recordsWritten: 3 });
      expect(mocks.redis.set).toHaveBeenCalledWith('cadence:sync-lock:c1', 'job-1', 'PX', 7_200_000, 'NX');
      expect(sync.createRun).toHaveBeenCalledWith('c1', range, 'webhook');
      expect(mocks.queue.removeDeduplicationKey).toHaveBeenCalledWith('debounce:c1');
      expect(j.updateData).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }));
      expect(sync.execute).toHaveBeenCalledWith('run-1');
      expect(mocks.redis.del).toHaveBeenCalledWith('cadence:sync-lock:c1');
    });

    it('widens a debounced job to days stored after it was queued, then clears them', async () => {
      await init();
      mocks.redis.set.mockResolvedValue('OK');
      // An event BullMQ ignored (the job had already left the delayed state) left its days in Redis.
      pending.set('cadence:debounce-range:c1', { from: D('2026-10-28').getTime(), to: range.to.getTime() });
      const j = job({});
      await processor()(j, 'tok');
      const widened = { from: D('2026-10-28'), to: range.to };
      expect(sync.createRun).toHaveBeenCalledWith('c1', widened, 'webhook');
      expect(j.updateData).toHaveBeenCalledWith(
        expect.objectContaining({ from: widened.from.toISOString(), to: widened.to.toISOString() }),
      );
      expect(pending.size).toBe(0);
    });

    it('reuses an existing run id and keeps a lock now held by someone else', async () => {
      await init();
      mocks.redis.set.mockResolvedValue('OK');
      mocks.redis.get.mockResolvedValue('other-job');
      await processor()(job({ runId: 'r9' }));
      expect(sync.createRun).not.toHaveBeenCalled();
      expect(mocks.queue.removeDeduplicationKey).not.toHaveBeenCalled();
      expect(sync.execute).toHaveBeenCalledWith('r9');
      expect(mocks.redis.del).not.toHaveBeenCalled();
    });

    it('releases the lock even when execution throws', async () => {
      await init();
      mocks.redis.set.mockResolvedValue('OK');
      mocks.redis.get.mockResolvedValue('job-1');
      sync.execute.mockRejectedValue(new Error('boom'));
      await expect(processor()(job({ runId: 'r9' }))).rejects.toThrow('boom');
      expect(mocks.redis.del).toHaveBeenCalled();
    });

    it('delays the job when another sync of the connection holds the lock', async () => {
      await init();
      mocks.redis.set.mockResolvedValue(null);
      const j = job({ runId: 'r9' });
      const before = Date.now();
      await expect(processor()(j, 'tok')).rejects.toThrow();
      const [until, token] = j.moveToDelayed.mock.calls[0];
      expect(until).toBeGreaterThanOrEqual(before + 30_000);
      expect(token).toBe('tok');
      expect(sync.execute).not.toHaveBeenCalled();
    });

    it('fans out the nightly sync-all job', async () => {
      await init();
      prisma.integrationConnection.findMany.mockResolvedValue([{ id: 'c1' }]);
      await processor()(job({}, { name: 'sync-all' }));
      expect(sync.rangeForDays).toHaveBeenCalledWith(2);
      expect(mocks.queue.add).toHaveBeenCalledWith(
        'sync',
        expect.objectContaining({ connectionId: 'c1', trigger: 'schedule' }),
        expect.anything(),
      );
      expect(mocks.redis.set).not.toHaveBeenCalled();
    });

    it('closes worker, queue and redis on shutdown', async () => {
      const d = await init();
      await d.onModuleDestroy();
      expect(mocks.worker.close).toHaveBeenCalled();
      expect(mocks.queue.close).toHaveBeenCalled();
      expect(mocks.redis.disconnect).toHaveBeenCalled();
    });
  });
});
