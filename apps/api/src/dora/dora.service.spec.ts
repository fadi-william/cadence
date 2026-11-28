import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DoraService } from './dora.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AccessScopeService } from '../org/access-scope.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = { id: 'admin', email: 'a@cadence.local', role: 'ADMIN' };
const lead: AuthenticatedUser = { id: 'tl1', email: 'tl@cadence.local', role: 'TRIBE_LEAD' };

const svcRow = (id: string, managerId: string | null) => ({
  id,
  name: `svc-${id}`,
  connectionId: 'c1',
  managerId,
  connection: { name: 'ADO', provider: 'AZURE_DEVOPS' },
  manager: managerId ? { name: `Mgr ${managerId}` } : null,
  _count: { deployments: 3 },
});
const dep = (
  serviceId: string,
  status: 'SUCCESS' | 'FAILED',
  finishedAt: string,
  leadTimeHours: number | null = null,
) => ({
  serviceId,
  status,
  finishedAt: new Date(finishedAt),
  leadTimeHours,
});

describe('DoraService', () => {
  const prisma = {
    deliveryService: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    deployment: { findMany: vi.fn() },
    reviewedPullRequest: { findMany: vi.fn() },
  };
  const scope = { managerIds: vi.fn(), assertManagerInScope: vi.fn() };
  const audit = { record: vi.fn() };
  const svc = new DoraService(
    prisma as unknown as PrismaService,
    scope as unknown as AccessScopeService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    scope.managerIds.mockImplementation(async (u: AuthenticatedUser) => (u.role === 'ADMIN' ? null : ['em1', 'em2']));
    prisma.reviewedPullRequest.findMany.mockResolvedValue([]);
  });

  describe('summary', () => {
    beforeEach(() => {
      prisma.deliveryService.findMany.mockResolvedValue([svcRow('s1', 'em1'), svcRow('s2', null)]);
      prisma.deployment.findMany.mockResolvedValue([
        dep('s1', 'SUCCESS', '2026-11-01T10:00:00Z', 4),
        dep('s1', 'FAILED', '2026-11-02T10:00:00Z', 1),
        dep('s1', 'SUCCESS', '2026-11-02T12:00:00Z', 10),
        dep('s2', 'SUCCESS', '2026-11-04T23:59:00Z', null),
      ]);
    });

    it('scopes services for non-admins and narrows by manager', async () => {
      await svc.summary(lead, '2026-11-01', '2026-11-04', 'em2');
      expect(prisma.deliveryService.findMany.mock.calls[0][0].where).toEqual({
        managerId: { in: ['em1', 'em2'] },
        AND: [{ managerId: 'em2' }],
      });
      await svc.summary(admin, '2026-11-01', '2026-11-04');
      expect(prisma.deliveryService.findMany.mock.calls[1][0].where).toEqual({});
    });

    it('reads deployments of those services through the end of the last day', async () => {
      await svc.summary(admin, '2026-11-01', '2026-11-04');
      expect(prisma.deployment.findMany.mock.calls[0][0].where).toEqual({
        serviceId: { in: ['s1', 's2'] },
        finishedAt: { gte: new Date('2026-11-01T00:00:00Z'), lt: new Date('2026-11-05T00:00:00Z') },
      });
    });

    it('computes frequency, CFR, lead time, MTTR, ratings and per-day/service breakdowns', async () => {
      const out = await svc.summary(admin, '2026-11-01', '2026-11-04');
      expect(out).toMatchObject({
        from: '2026-11-01',
        to: '2026-11-04',
        deployments: 4,
        failedDeployments: 1,
        deploymentsPerDay: 0.75,
        changeFailureRate: 0.25,
        leadTimeHoursMedian: 7,
        mttrHours: 2,
        ratings: { deploymentFrequency: 'HIGH', leadTime: 'ELITE', changeFailureRate: 'LOW', mttr: 'HIGH' },
      });
      expect(out.daily).toEqual([
        { date: '2026-11-01', deployments: 1, failures: 0 },
        { date: '2026-11-02', deployments: 2, failures: 1 },
        { date: '2026-11-03', deployments: 0, failures: 0 },
        { date: '2026-11-04', deployments: 1, failures: 0 },
      ]);
      expect(out.services).toEqual([
        {
          id: 's1',
          name: 'svc-s1',
          connectionName: 'ADO',
          managerId: 'em1',
          managerName: 'Mgr em1',
          deployments: 3,
          failures: 1,
          leadTimeHoursMedian: 4,
        },
        {
          id: 's2',
          name: 'svc-s2',
          connectionName: 'ADO',
          managerId: null,
          managerName: null,
          deployments: 1,
          failures: 0,
          leadTimeHoursMedian: null,
        },
      ]);
    });

    it('returns null metrics and ratings with no deployments', async () => {
      prisma.deployment.findMany.mockResolvedValue([]);
      const out = await svc.summary(admin, '2026-11-01', '2026-11-04');
      expect(out).toMatchObject({
        deployments: 0,
        deploymentsPerDay: 0,
        changeFailureRate: null,
        leadTimeHoursMedian: null,
        mttrHours: null,
        ratings: { deploymentFrequency: null, leadTime: null, changeFailureRate: null, mttr: null },
        reviewWaitHoursMedian: null,
        reviewedPullRequests: 0,
      });
    });

    it('reports the median review wait of PRs by people in scope', async () => {
      prisma.reviewedPullRequest.findMany.mockResolvedValue([{ waitHours: 1 }, { waitHours: 30 }, { waitHours: 2.26 }]);
      const out = await svc.summary(lead, '2026-11-01', '2026-11-04', 'em2');
      expect(out).toMatchObject({ reviewWaitHoursMedian: 2.3, reviewedPullRequests: 3 });
      expect(prisma.reviewedPullRequest.findMany).toHaveBeenCalledWith({
        where: {
          date: { gte: new Date('2026-11-01T00:00:00Z'), lte: new Date('2026-11-04T00:00:00Z') },
          member: { AND: [{ managerId: { in: ['em1', 'em2'] } }, { managerId: 'em2' }] },
        },
        select: { waitHours: true },
      });
    });

    it('does not limit review wait to a team for admins', async () => {
      await svc.summary(admin, '2026-11-01', '2026-11-04');
      expect(prisma.reviewedPullRequest.findMany.mock.calls[0][0].where.member).toEqual({ AND: [] });
    });
  });

  it('services maps rows with deployment counts', async () => {
    prisma.deliveryService.findMany.mockResolvedValue([svcRow('s1', 'em1')]);
    await expect(svc.services(lead)).resolves.toEqual([
      {
        id: 's1',
        name: 'svc-s1',
        connectionId: 'c1',
        connectionName: 'ADO',
        provider: 'AZURE_DEVOPS',
        managerId: 'em1',
        managerName: 'Mgr em1',
        deploymentCount: 3,
      },
    ]);
    expect(prisma.deliveryService.findMany.mock.calls[0][0].where).toEqual({ managerId: { in: ['em1', 'em2'] } });
  });

  describe('setOwner', () => {
    beforeEach(() => prisma.deliveryService.findMany.mockResolvedValue([svcRow('s1', 'em2')]));

    it('404s for unknown services', async () => {
      prisma.deliveryService.findUnique.mockResolvedValue(null);
      await expect(svc.setOwner(admin, 'x', 'em1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('admins can assign any service, including unassigning', async () => {
      prisma.deliveryService.findUnique.mockResolvedValue(svcRow('s1', null));
      await svc.setOwner(admin, 's1', 'em2');
      expect(scope.assertManagerInScope).toHaveBeenCalledWith(admin, 'em2');
      expect(prisma.deliveryService.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { managerId: 'em2' } });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'service.owner_changed',
          metadata: { name: 'svc-s1', from: null, to: 'em2' },
        }),
      );

      prisma.deliveryService.findUnique.mockResolvedValue(svcRow('s1', 'em2'));
      scope.assertManagerInScope.mockClear();
      await svc.setOwner(admin, 's1', null);
      expect(scope.assertManagerInScope).not.toHaveBeenCalled();
      expect(prisma.deliveryService.update).toHaveBeenLastCalledWith({
        where: { id: 's1' },
        data: { managerId: null },
      });
    });

    it('tribe leads may only move services between their own EMs', async () => {
      prisma.deliveryService.findUnique.mockResolvedValue(svcRow('s1', 'em1'));
      const out = await svc.setOwner(lead, 's1', 'em2');
      expect(out).toMatchObject({ id: 's1', managerId: 'em2' });

      await expect(svc.setOwner(lead, 's1', 'em9')).rejects.toThrow('Manager outside your scope');
      await expect(svc.setOwner(lead, 's1', null)).rejects.toThrow('Manager outside your scope');

      prisma.deliveryService.findUnique.mockResolvedValue(svcRow('s1', null));
      await expect(svc.setOwner(lead, 's1', 'em1')).rejects.toThrow('Service outside your scope');
      prisma.deliveryService.findUnique.mockResolvedValue(svcRow('s1', 'em9'));
      await expect(svc.setOwner(lead, 's1', 'em1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.deliveryService.update).toHaveBeenCalledTimes(1);
    });

    it('returns null when the service leaves the actor’s visible set', async () => {
      prisma.deliveryService.findUnique.mockResolvedValue(svcRow('s1', 'em1'));
      prisma.deliveryService.findMany.mockResolvedValue([]);
      await expect(svc.setOwner(lead, 's1', 'em2')).resolves.toBeNull();
    });
  });
});
