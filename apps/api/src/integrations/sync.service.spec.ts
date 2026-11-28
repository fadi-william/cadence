import { Logger } from '@nestjs/common';
import { SyncService, utcMidnight } from './sync.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { CryptoService } from '../common/crypto/crypto.service';
import type { AdapterRegistry } from './adapters/adapter.registry';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('utcMidnight', () => {
  it('truncates to the UTC day', () => {
    expect(utcMidnight(new Date('2026-11-27T23:59:59.999Z'))).toEqual(D('2026-11-27'));
    expect(utcMidnight(new Date('2026-11-27T01:00:00+05:00'))).toEqual(D('2026-11-26'));
  });
});

describe('SyncService', () => {
  const tx = (name: string) => vi.fn((args: unknown) => ({ op: name, args }));
  const prisma = {
    syncRun: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    externalIdentity: { findMany: vi.fn() },
    dailyMetric: {
      count: vi.fn(),
      deleteMany: tx('dm.deleteMany'),
      createMany: tx('dm.createMany'),
      updateMany: tx('dm.updateMany'),
      upsert: tx('dm.upsert'),
    },
    workItem: { deleteMany: tx('wi.deleteMany'), upsert: tx('wi.upsert') },
    reviewedPullRequest: { deleteMany: tx('pr.deleteMany'), createMany: tx('pr.createMany') },
    deliveryService: { upsert: vi.fn() },
    deployment: { upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  const crypto = { decrypt: vi.fn(() => 'pat') };
  const registry = { get: vi.fn() };
  const svc = new SyncService(
    prisma as unknown as PrismaService,
    crypto as unknown as CryptoService,
    registry as unknown as AdapterRegistry,
  );
  const connection = {
    id: 'c1',
    name: 'ADO',
    provider: 'AZURE_DEVOPS',
    baseUrl: 'https://dev.azure.com/cadence',
    config: null,
    encryptedSecret: 'enc',
    features: ['WORK_TRACKING', 'SOURCE_CONTROL', 'DEPLOYMENTS'],
  };
  const queued = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    status: 'QUEUED',
    rangeFrom: D('2026-11-01'),
    rangeTo: D('2026-11-02'),
    connection,
    ...over,
  });
  const identities = [{ memberId: 'm1', username: 'nour', externalId: null }];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.syncRun.findUnique.mockResolvedValue(queued());
    prisma.syncRun.update.mockImplementation(async ({ data }) => ({ id: 'r1', ...data }));
    prisma.externalIdentity.findMany.mockResolvedValue(identities);
    prisma.$transaction.mockResolvedValue([]);
    prisma.dailyMetric.count.mockResolvedValue(0);
    prisma.deliveryService.upsert.mockImplementation(async ({ create }) => ({ id: `svc-${create.name}` }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('rangeForDays covers the last N days including today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T18:00:00Z'));
    expect(svc.rangeForDays(14)).toEqual({ from: D('2026-11-14'), to: D('2026-11-27') });
    expect(svc.rangeForDays(1)).toEqual({ from: D('2026-11-27'), to: D('2026-11-27') });
    vi.useRealTimers();
  });

  it('createRun stores a QUEUED run', async () => {
    await svc.createRun('c1', { from: D('2026-11-01'), to: D('2026-11-02') }, 'webhook');
    expect(prisma.syncRun.create).toHaveBeenCalledWith({
      data: {
        connectionId: 'c1',
        rangeFrom: D('2026-11-01'),
        rangeTo: D('2026-11-02'),
        trigger: 'webhook',
        status: 'QUEUED',
      },
    });
  });

  describe('execute', () => {
    it.each([null, 'SUCCESS', 'FAILED'])('does nothing for a missing or finished run (%s)', async (status) => {
      const found = status ? queued({ status }) : null;
      prisma.syncRun.findUnique.mockResolvedValue(found);
      await expect(svc.execute('r1')).resolves.toBe(found);
      expect(prisma.syncRun.update).not.toHaveBeenCalled();
    });

    it('pulls from every capability the adapter has, replaces the range and records success', async () => {
      const adapter = {
        fetchWorkItemActivity: vi.fn().mockResolvedValue([
          { memberId: 'm1', date: '2026-11-01', workItemKey: 'K-1', issuesCompleted: 1, storyPoints: 3 },
          { memberId: 'm1', date: '2026-10-01', commits: 9 }, // outside the range: dropped
        ]),
        fetchCodeActivity: vi.fn().mockResolvedValue([{ memberId: 'm1', date: '2026-11-02', commits: 2 }]),
        fetchDeployments: vi.fn().mockResolvedValue([
          {
            externalId: 'd1',
            service: 'api',
            environment: 'prod',
            status: 'SUCCESS',
            finishedAt: '2026-11-01T10:00:00Z',
            leadTimeHours: 5,
          },
          {
            externalId: 'd2',
            service: 'api',
            environment: 'prod',
            status: 'FAILED',
            startedAt: '2026-11-02T09:00:00Z',
            finishedAt: '2026-11-02T10:00:00Z',
          },
        ]),
      };
      registry.get.mockReturnValue(adapter);

      const out = await svc.execute('r1');

      expect(prisma.syncRun.update.mock.calls[0][0]).toEqual({
        where: { id: 'r1' },
        data: { status: 'RUNNING', startedAt: expect.any(Date) },
      });
      const ctx = { baseUrl: 'https://dev.azure.com/cadence', config: {}, secret: 'pat' };
      const range = { from: D('2026-11-01'), to: D('2026-11-02') };
      expect(adapter.fetchWorkItemActivity).toHaveBeenCalledWith(ctx, identities, range);
      expect(adapter.fetchCodeActivity).toHaveBeenCalledWith(ctx, identities, range);
      expect(adapter.fetchDeployments).toHaveBeenCalledWith(ctx, range);

      const ops = prisma.$transaction.mock.calls[0][0] as { op: string; args: any }[];
      expect(ops.map((o) => o.op)).toEqual([
        'dm.deleteMany',
        'dm.createMany',
        'wi.deleteMany',
        'wi.upsert',
        'pr.deleteMany',
        'pr.createMany',
      ]);
      expect(ops[0].args).toEqual({ where: { connectionId: 'c1', date: { gte: range.from, lte: range.to } } });
      expect(ops[1].args.data).toHaveLength(2);
      expect(ops[1].args.data.every((r: { connectionId: string }) => r.connectionId === 'c1')).toBe(true);
      expect(ops[3].args).toMatchObject({
        where: { connectionId_key: { connectionId: 'c1', key: 'K-1' } },
        create: { key: 'K-1', storyPoints: 3, connectionId: 'c1', contributors: { create: [{ memberId: 'm1' }] } },
        update: { contributors: { deleteMany: {}, create: [{ memberId: 'm1' }] } },
      });

      expect(prisma.deliveryService.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.deployment.upsert).toHaveBeenCalledWith({
        where: { serviceId_externalId: { serviceId: 'svc-api', externalId: 'd2' } },
        create: expect.objectContaining({ serviceId: 'svc-api', externalId: 'd2', status: 'FAILED' }),
        update: {
          environment: 'prod',
          status: 'FAILED',
          startedAt: new Date('2026-11-02T09:00:00Z'),
          finishedAt: new Date('2026-11-02T10:00:00Z'),
          leadTimeHours: null,
        },
      });
      expect(prisma.deployment.upsert.mock.calls[0][0].update).toMatchObject({ startedAt: null, leadTimeHours: 5 });
      expect(out).toMatchObject({ status: 'SUCCESS', recordsWritten: 4, finishedAt: expect.any(Date) });
    });

    it('re-runs a RUNNING run (e.g. after a crash) and skips capabilities the adapter lacks', async () => {
      prisma.syncRun.findUnique.mockResolvedValue(queued({ status: 'RUNNING' }));
      const adapter = { fetchCodeActivity: vi.fn().mockResolvedValue([]) };
      registry.get.mockReturnValue(adapter);
      const out = await svc.execute('r1');
      expect(prisma.deliveryService.upsert).not.toHaveBeenCalled();
      expect(out).toMatchObject({ status: 'SUCCESS', recordsWritten: 0 });
    });

    it('syncs only the features enabled on the connection', async () => {
      prisma.syncRun.findUnique.mockResolvedValue(
        queued({ connection: { ...connection, features: ['SOURCE_CONTROL'] } }),
      );
      const adapter = {
        fetchWorkItemActivity: vi.fn(),
        fetchCodeActivity: vi.fn().mockResolvedValue([{ memberId: 'm1', date: '2026-11-02', commits: 2 }]),
        fetchDeployments: vi.fn(),
      };
      registry.get.mockReturnValue(adapter);
      const out = await svc.execute('r1');
      expect(adapter.fetchWorkItemActivity).not.toHaveBeenCalled();
      expect(adapter.fetchDeployments).not.toHaveBeenCalled();
      const ops = prisma.$transaction.mock.calls[0][0] as { op: string }[];
      // Work items are left alone; with no kept work-tracking history the rows are simply replaced.
      expect(ops.map((o) => o.op)).toEqual(['dm.deleteMany', 'dm.createMany', 'pr.deleteMany', 'pr.createMany']);
      expect(prisma.dailyMetric.count.mock.calls[0][0].where.OR).toContainEqual({ issuesCompleted: { not: 0 } });
      expect(out).toMatchObject({ status: 'SUCCESS', recordsWritten: 1 });
    });

    it('rewrites only the synced columns when a turned-off feature kept its history', async () => {
      prisma.syncRun.findUnique.mockResolvedValue(
        queued({ connection: { ...connection, features: ['SOURCE_CONTROL'] } }),
      );
      prisma.dailyMetric.count.mockResolvedValue(3);
      registry.get.mockReturnValue({
        fetchCodeActivity: vi
          .fn()
          .mockResolvedValue([{ memberId: 'm1', date: '2026-11-02', commits: 2, prsRaised: 1 }]),
      });
      await svc.execute('r1');
      const ops = prisma.$transaction.mock.calls[0][0] as { op: string; args: any }[];
      expect(ops.map((o) => o.op)).toEqual([
        'dm.updateMany',
        'dm.upsert',
        'dm.deleteMany',
        'pr.deleteMany',
        'pr.createMany',
      ]);
      const where = { connectionId: 'c1', date: { gte: D('2026-11-01'), lte: D('2026-11-02') } };
      expect(ops[0].args).toEqual({ where, data: { commits: 0, prsRaised: 0, prsReviewed: 0, prsMerged: 0 } });
      expect(ops[1].args).toEqual({
        where: { memberId_connectionId_date: { memberId: 'm1', connectionId: 'c1', date: D('2026-11-02') } },
        create: expect.objectContaining({ memberId: 'm1', commits: 2, issuesCompleted: 0 }),
        update: { commits: 2, prsRaised: 1, prsReviewed: 0, prsMerged: 0 },
      });
      // Rows emptied by the clear (no activity of any kind left) are removed.
      expect(ops[2].args.where).toMatchObject({ ...where, commits: 0, issuesCompleted: 0, holdSamples: 0 });
    });

    it('replaces the reviewed pull requests of the range when source control is on', async () => {
      prisma.syncRun.findUnique.mockResolvedValue(
        queued({ connection: { ...connection, features: ['SOURCE_CONTROL'] } }),
      );
      registry.get.mockReturnValue({
        fetchCodeActivity: vi.fn().mockResolvedValue([
          { memberId: 'm1', date: '2026-11-02', pullRequestKey: 'r1-7', reviewWaitHours: 3.456 },
          { memberId: 'm1', date: '2026-11-02', pullRequestKey: 'r1-7', reviewWaitHours: 9 }, // duplicate key
          { memberId: 'm1', date: '2026-10-20', pullRequestKey: 'r1-8', reviewWaitHours: 1 }, // outside the range
        ]),
      });
      await svc.execute('r1');
      const ops = prisma.$transaction.mock.calls[0][0] as { op: string; args: any }[];
      const del = ops.find((o) => o.op === 'pr.deleteMany')!;
      const create = ops.find((o) => o.op === 'pr.createMany')!;
      expect(del.args).toEqual({ where: { connectionId: 'c1', date: { gte: D('2026-11-01'), lte: D('2026-11-02') } } });
      expect(create.args).toEqual({
        data: [{ key: 'r1-7', memberId: 'm1', date: D('2026-11-02'), waitHours: 3.46, connectionId: 'c1' }],
        skipDuplicates: true,
      });
    });

    it('writes no metrics when only deployments are enabled', async () => {
      prisma.syncRun.findUnique.mockResolvedValue(queued({ connection: { ...connection, features: ['DEPLOYMENTS'] } }));
      registry.get.mockReturnValue({ fetchCodeActivity: vi.fn(), fetchDeployments: vi.fn().mockResolvedValue([]) });
      await svc.execute('r1');
      expect(prisma.$transaction).toHaveBeenCalledWith([]);
      expect(prisma.dailyMetric.count).not.toHaveBeenCalled();
    });

    it('records adapter errors on the run (truncated) instead of throwing', async () => {
      registry.get.mockReturnValue({ fetchWorkItemActivity: vi.fn().mockRejectedValue(new Error('x'.repeat(3000))) });
      const out = await svc.execute('r1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(out).toMatchObject({ status: 'FAILED', error: 'x'.repeat(2000) });
    });

    it('records a missing adapter as a failure', async () => {
      registry.get.mockImplementation(() => {
        throw new Error('No adapter registered for AZURE_DEVOPS');
      });
      await expect(svc.execute('r1')).resolves.toMatchObject({
        status: 'FAILED',
        error: expect.stringContaining('No adapter'),
      });
    });
  });

  it('markFailed only touches unfinished runs', async () => {
    await svc.markFailed('r1', 'boom');
    expect(prisma.syncRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', finishedAt: expect.any(Date), error: 'boom' },
    });
  });
});
