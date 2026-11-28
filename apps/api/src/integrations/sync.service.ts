import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AdapterRegistry } from './adapters/adapter.registry';
import {
  ActivityRecord,
  DateRange,
  DeploymentRecord,
  isDeployments,
  isSourceControl,
  isWorkTracking,
} from './adapters/adapter.types';
import { aggregate, reviewedPullRequests, workItems } from './aggregate';
import { emptyMetricRow, METRIC_COLUMNS, metricColumns, type MetricKind, zeroColumns } from './features';
import { DeploymentStatus, IntegrationKind, SyncStatus } from '../generated/prisma/enums';
import type { Prisma, SyncRun } from '../generated/prisma/client';

/** Start of `d`'s UTC day. */
export const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** What started a sync run: an admin's "Sync now", the nightly schedule, or an inbound webhook. */
export type SyncTrigger = 'manual' | 'schedule' | 'webhook';

/**
 * Executes one sync run: pulls activity (and deployments) from the adapter for the connection's enabled
 * features and writes them. Idempotent: the enabled features' daily metrics and work items in the range are
 * replaced; deployments are upserted by external id. Data of turned-off features is left as it is, so
 * history an admin chose to keep stays in dashboards. Scheduling, queueing and locking live in
 * {@link SyncDispatcher}.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: AdapterRegistry,
  ) {}

  /** The last `days` days including today. */
  rangeForDays(days: number): DateRange {
    const to = utcMidnight(new Date());
    return { from: new Date(to.getTime() - (days - 1) * 864e5), to };
  }

  /** Records a QUEUED run for the range. It does not start it; see `SyncDispatcher.enqueue`. */
  createRun(connectionId: string, range: DateRange, trigger: SyncTrigger) {
    return this.prisma.syncRun.create({
      data: { connectionId, rangeFrom: range.from, rangeTo: range.to, trigger, status: SyncStatus.QUEUED },
    });
  }

  /**
   * Runs a QUEUED (or RUNNING, e.g. a retried job) run to completion. Fetches records for every capability
   * that the adapter has and the connection has enabled (`features`), then in one transaction replaces
   * those capabilities' `DailyMetric` columns and `WorkItem` rows in the range; deployments are upserted
   * afterwards.
   *
   * Errors while fetching or writing are caught: the run is marked FAILED with the message (truncated to
   * 2000 characters) instead of throwing.
   *
   * @returns The finished run; the run unchanged when it is already SUCCESS or FAILED; null when it does
   * not exist.
   */
  async execute(runId: string): Promise<SyncRun | null> {
    const run = await this.prisma.syncRun.findUnique({ where: { id: runId }, include: { connection: true } });
    if (!run || (run.status !== SyncStatus.QUEUED && run.status !== SyncStatus.RUNNING)) return run;
    const { connection } = run;
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: { status: SyncStatus.RUNNING, startedAt: new Date() },
    });
    const range = { from: run.rangeFrom, to: run.rangeTo };

    try {
      const adapter = this.registry.get(connection.provider);
      const ctx = {
        baseUrl: connection.baseUrl,
        config: (connection.config ?? {}) as Record<string, unknown>,
        secret: this.crypto.decrypt(connection.encryptedSecret),
      };
      const identities = await this.prisma.externalIdentity.findMany({
        where: { connectionId: connection.id },
        select: { memberId: true, username: true, externalId: true },
      });

      const enabled = new Set(connection.features);
      const workTracking = enabled.has(IntegrationKind.WORK_TRACKING) && isWorkTracking(adapter);
      const sourceControl = enabled.has(IntegrationKind.SOURCE_CONTROL) && isSourceControl(adapter);
      const records: ActivityRecord[] = [];
      if (workTracking) records.push(...(await adapter.fetchWorkItemActivity(ctx, identities, range)));
      if (sourceControl) records.push(...(await adapter.fetchCodeActivity(ctx, identities, range)));
      const deployments =
        enabled.has(IntegrationKind.DEPLOYMENTS) && isDeployments(adapter)
          ? await adapter.fetchDeployments(ctx, range)
          : [];

      const synced: MetricKind[] = [];
      if (workTracking) synced.push(IntegrationKind.WORK_TRACKING);
      if (sourceControl) synced.push(IntegrationKind.SOURCE_CONTROL);
      const rows = aggregate(records, range).map((r) => ({ ...r, connectionId: connection.id }));
      await this.prisma.$transaction([
        ...(await this.replaceMetrics(connection.id, range, synced, rows)),
        ...(workTracking ? this.replaceWorkItems(connection.id, range, records) : []),
        ...(sourceControl ? this.replaceReviewedPullRequests(connection.id, range, records) : []),
      ]);
      const deploymentCount = await this.saveDeployments(connection.id, deployments);

      return await this.prisma.syncRun.update({
        where: { id: runId },
        data: { status: SyncStatus.SUCCESS, finishedAt: new Date(), recordsWritten: rows.length + deploymentCount },
      });
    } catch (e) {
      const message = (e as Error).message.slice(0, 2000);
      this.logger.warn(`Sync ${connection.name} failed: ${message}`);
      return await this.prisma.syncRun.update({
        where: { id: runId },
        data: { status: SyncStatus.FAILED, finishedAt: new Date(), error: message },
      });
    }
  }

  /**
   * Operations that replace the `synced` capabilities' `DailyMetric` columns in the range with `rows`.
   *
   * @remarks
   * When no other capability has data in the range (the usual case), rows are simply deleted and
   * re-created. Otherwise, such as when an admin turned a capability off and kept its history, only the
   * synced columns are cleared and re-written, and rows left with nothing in them are deleted.
   */
  private async replaceMetrics(
    connectionId: string,
    range: DateRange,
    synced: MetricKind[],
    rows: Prisma.DailyMetricCreateManyInput[],
  ) {
    if (!synced.length) return [];
    const where = { connectionId, date: { gte: range.from, lte: range.to } };
    const others = (Object.keys(METRIC_COLUMNS) as MetricKind[]).filter((k) => !synced.includes(k));
    const otherColumns = metricColumns(others);
    const keptElsewhere =
      otherColumns.length > 0 &&
      (await this.prisma.dailyMetric.count({
        where: { ...where, OR: otherColumns.map((c) => ({ [c]: { not: 0 } })) },
      })) > 0;
    if (!keptElsewhere) {
      return [this.prisma.dailyMetric.deleteMany({ where }), this.prisma.dailyMetric.createMany({ data: rows })];
    }
    const columns = metricColumns(synced);
    return [
      this.prisma.dailyMetric.updateMany({ where, data: zeroColumns(synced) }),
      ...rows.map((row) =>
        this.prisma.dailyMetric.upsert({
          where: { memberId_connectionId_date: { memberId: row.memberId, connectionId, date: row.date } },
          create: row,
          update: Object.fromEntries(columns.map((c) => [c, row[c]])),
        }),
      ),
      this.prisma.dailyMetric.deleteMany({ where: { ...where, ...emptyMetricRow } }),
    ];
  }

  /** Operations that replace the connection's reviewed pull requests (by first-review day) in the range. */
  private replaceReviewedPullRequests(connectionId: string, range: DateRange, records: ActivityRecord[]) {
    const rows = reviewedPullRequests(records, range).map((r) => ({ ...r, connectionId }));
    return [
      this.prisma.reviewedPullRequest.deleteMany({
        where: { connectionId, date: { gte: range.from, lte: range.to } },
      }),
      // A PR re-reviewed into a later range keeps its first-review day: skip keys already stored outside it.
      this.prisma.reviewedPullRequest.createMany({ data: rows, skipDuplicates: true }),
    ];
  }

  /** Operations that replace the connection's completed work items in the range with those in `records`. */
  private replaceWorkItems(connectionId: string, range: DateRange, records: ActivityRecord[]) {
    return [
      this.prisma.workItem.deleteMany({ where: { connectionId, date: { gte: range.from, lte: range.to } } }),
      ...workItems(records, range).map(({ memberIds, ...item }) =>
        this.prisma.workItem.upsert({
          where: { connectionId_key: { connectionId, key: item.key } },
          create: {
            ...item,
            connectionId,
            contributors: { create: [...memberIds].map((memberId) => ({ memberId })) },
          },
          update: {
            ...item,
            contributors: { deleteMany: {}, create: [...memberIds].map((memberId) => ({ memberId })) },
          },
        }),
      ),
    ];
  }

  /** Marks a run FAILED unless it already finished. Used when {@link SyncService.execute} itself throws. */
  async markFailed(runId: string, error: string) {
    await this.prisma.syncRun.updateMany({
      where: { id: runId, status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
      data: { status: SyncStatus.FAILED, finishedAt: new Date(), error },
    });
  }

  /**
   * Creates a `DeliveryService` per distinct service name (keeping existing ones and their owners) and
   * upserts each deployment by service and external id.
   *
   * @returns The number of deployment records written.
   */
  private async saveDeployments(connectionId: string, records: DeploymentRecord[]) {
    const serviceIds = new Map<string, string>();
    for (const name of new Set(records.map((r) => r.service))) {
      const svc = await this.prisma.deliveryService.upsert({
        where: { connectionId_name: { connectionId, name } },
        create: { connectionId, name },
        update: {},
      });
      serviceIds.set(name, svc.id);
    }
    for (const r of records) {
      const serviceId = serviceIds.get(r.service)!;
      const data = {
        environment: r.environment,
        status: r.status === 'FAILED' ? DeploymentStatus.FAILED : DeploymentStatus.SUCCESS,
        startedAt: r.startedAt ? new Date(r.startedAt) : null,
        finishedAt: new Date(r.finishedAt),
        leadTimeHours: r.leadTimeHours ?? null,
      };
      await this.prisma.deployment.upsert({
        where: { serviceId_externalId: { serviceId, externalId: r.externalId } },
        create: { serviceId, externalId: r.externalId, ...data },
        update: data,
      });
    }
    return records.length;
  }
}
