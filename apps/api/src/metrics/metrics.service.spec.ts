import { NotFoundException } from '@nestjs/common';
import { MetricsService, parseRange, previousRange } from './metrics.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AccessScopeService } from '../org/access-scope.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const em: AuthenticatedUser = { id: 'em1', email: 'em@cadence.local', role: 'ENGINEERING_MANAGER' };

const ZERO = {
  commits: 0,
  prsRaised: 0,
  prsReviewed: 0,
  prsMerged: 0,
  issuesCompleted: 0,
  storyPoints: 0,
  cycleTimeHoursAvg: null,
  assignmentsCompleted: 0,
  assignmentsHandedOver: 0,
  assignmentsReworked: 0,
  holdTimeHoursAvg: null,
};

/** A Prisma `_sum` result: unspecified fields are null like an empty aggregate. */
const sums = (s: Record<string, number> = {}) => ({
  commits: null,
  prsRaised: null,
  prsReviewed: null,
  prsMerged: null,
  issuesCompleted: null,
  storyPoints: null,
  cycleTimeHoursSum: null,
  cycleTimeSamples: null,
  assignmentsCompleted: null,
  assignmentsHandedOver: null,
  assignmentsReworked: null,
  holdHoursSum: null,
  holdSamples: null,
  ...s,
});
const items = (count: number, points: number | null, cycleCount = 0, cycleSum: number | null = null) => ({
  _count: { _all: count, cycleTimeHours: cycleCount },
  _sum: { storyPoints: points, cycleTimeHours: cycleSum },
});

describe('parseRange / previousRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T15:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('defaults to the last 30 days ending today (UTC)', () => {
    expect(parseRange()).toEqual({ from: D('2026-10-29'), to: D('2026-11-27') });
    expect(parseRange(undefined, '2026-01-30')).toEqual({ from: D('2026-01-01'), to: D('2026-01-30') });
  });

  it('collapses an inverted range to the end day', () => {
    expect(parseRange('2026-11-10', '2026-11-01')).toEqual({ from: D('2026-11-01'), to: D('2026-11-01') });
  });

  it('caps ranges at 730 days', () => {
    expect(parseRange('2020-01-01', '2026-11-27')).toEqual({
      from: new Date(D('2026-11-27').getTime() - 730 * 864e5),
      to: D('2026-11-27'),
    });
  });

  it('previousRange is the equal-length window just before', () => {
    expect(previousRange(D('2026-11-08'), D('2026-11-14'))).toEqual({ from: D('2026-11-01'), to: D('2026-11-07') });
    expect(previousRange(D('2026-11-08'), D('2026-11-08'))).toEqual({ from: D('2026-11-07'), to: D('2026-11-07') });
  });
});

describe('MetricsService', () => {
  const prisma = {
    dailyMetric: { groupBy: vi.fn(), aggregate: vi.fn() },
    workItem: { aggregate: vi.fn(), groupBy: vi.fn() },
    externalIdentity: { findMany: vi.fn() },
    integrationConnection: { findMany: vi.fn() },
    member: { findMany: vi.fn() },
    reviewedPullRequest: { findMany: vi.fn() },
  };
  const scope = { assertMemberInScope: vi.fn(), memberWhere: vi.fn() };
  const svc = new MetricsService(prisma as unknown as PrismaService, scope as unknown as AccessScopeService);

  beforeEach(() => {
    vi.resetAllMocks();
    scope.memberWhere.mockResolvedValue({ managerId: { in: ['em1'] } });
  });

  describe('member', () => {
    beforeEach(() => {
      prisma.dailyMetric.groupBy.mockImplementation(async ({ by }) =>
        by[0] === 'date'
          ? [{ date: D('2026-11-02'), _sum: sums({ commits: 3, cycleTimeHoursSum: 25, cycleTimeSamples: 3 }) }]
          : [{ connectionId: 'c-old', _sum: sums({ commits: 3 }) }],
      );
      prisma.dailyMetric.aggregate
        .mockResolvedValueOnce({
          _sum: sums({
            commits: 3,
            storyPoints: 2.25,
            cycleTimeHoursSum: 25,
            cycleTimeSamples: 3,
            holdHoursSum: 10,
            holdSamples: 4,
          }),
        })
        .mockResolvedValueOnce({ _sum: sums() });
      prisma.externalIdentity.findMany.mockResolvedValue([{ connectionId: 'c-jira', username: 'nour' }]);
      prisma.integrationConnection.findMany.mockResolvedValue([
        { id: 'c-jira', name: 'Jira', provider: 'JIRA' },
        { id: 'c-old', name: 'Old ADO', provider: 'AZURE_DEVOPS' },
      ]);
      prisma.reviewedPullRequest.findMany.mockImplementation(async ({ where }) =>
        where.date.gte.getTime() === D('2026-11-01').getTime()
          ? [{ waitHours: 4 }, { waitHours: 1 }, { waitHours: 10 }]
          : [],
      );
    });

    it('enforces scope before reading anything', async () => {
      scope.assertMemberInScope.mockRejectedValue(new NotFoundException());
      await expect(svc.member(em, 'm9', '2026-11-01', '2026-11-03')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.dailyMetric.groupBy).not.toHaveBeenCalled();
    });

    it('fills every day, rounds averages and compares with the previous window', async () => {
      const out = await svc.member(em, 'm1', '2026-11-01', '2026-11-03');
      expect(scope.assertMemberInScope).toHaveBeenCalledWith(em, 'm1');
      expect(prisma.dailyMetric.aggregate.mock.calls[1][0].where).toEqual({
        memberId: 'm1',
        date: { gte: D('2026-10-29'), lte: D('2026-10-31') },
      });
      expect(out).toMatchObject({ memberId: 'm1', from: '2026-11-01', to: '2026-11-03' });
      expect(out.totals).toEqual({
        ...ZERO,
        commits: 3,
        storyPoints: 2.3,
        cycleTimeHoursAvg: 8.3,
        holdTimeHoursAvg: 2.5,
      });
      expect(out.previous).toEqual(ZERO);
      expect(out.days.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
      expect(out.days[0]).toEqual({ date: '2026-11-01', ...ZERO });
      expect(out.days[1]).toMatchObject({ commits: 3, cycleTimeHoursAvg: 8.3 });
    });

    it('lists linked platforms without activity and historical sources without a link', async () => {
      const out = await svc.member(em, 'm1', '2026-11-01', '2026-11-03');
      expect(prisma.integrationConnection.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(['c-jira', 'c-old']);
      expect(out.sources).toEqual([
        { connectionId: 'c-jira', connectionName: 'Jira', provider: 'JIRA', username: 'nour', totals: ZERO },
        {
          connectionId: 'c-old',
          connectionName: 'Old ADO',
          provider: 'AZURE_DEVOPS',
          username: null,
          totals: { ...ZERO, commits: 3 },
        },
      ]);
    });
  });

  describe('member review wait', () => {
    beforeEach(() => {
      prisma.dailyMetric.groupBy.mockResolvedValue([]);
      prisma.dailyMetric.aggregate.mockResolvedValue({ _sum: sums() });
      prisma.externalIdentity.findMany.mockResolvedValue([]);
      prisma.integrationConnection.findMany.mockResolvedValue([]);
    });

    it('reports the median wait of the member own PRs, with the previous window', async () => {
      prisma.reviewedPullRequest.findMany.mockImplementation(async ({ where }) =>
        where.date.gte.getTime() === D('2026-11-01').getTime()
          ? [{ waitHours: 4 }, { waitHours: 1 }, { waitHours: 10.04 }, { waitHours: 2 }]
          : [{ waitHours: 6 }],
      );
      const out = await svc.member(em, 'm1', '2026-11-01', '2026-11-03');
      expect(out.reviewWait).toEqual({ hoursMedian: 3, pullRequests: 4, previousHoursMedian: 6 });
      expect(prisma.reviewedPullRequest.findMany).toHaveBeenCalledWith({
        where: { memberId: 'm1', date: { gte: D('2026-11-01'), lte: D('2026-11-03') } },
        select: { waitHours: true },
      });
    });

    it('is null without reviewed PRs', async () => {
      prisma.reviewedPullRequest.findMany.mockResolvedValue([]);
      const out = await svc.member(em, 'm1', '2026-11-01', '2026-11-03');
      expect(out.reviewWait).toEqual({ hoursMedian: null, pullRequests: 0, previousHoursMedian: null });
    });
  });

  describe('summary', () => {
    beforeEach(() => {
      prisma.member.findMany.mockResolvedValue([
        { id: 'm1', name: 'Nour', manager: { name: 'Hana' } },
        { id: 'm2', name: 'Omar', manager: { name: 'Hana' } },
      ]);
      prisma.dailyMetric.groupBy.mockResolvedValue([
        { memberId: 'm1', _sum: sums({ commits: 2, issuesCompleted: 1, storyPoints: 3 }) },
      ]);
      prisma.dailyMetric.aggregate.mockResolvedValue({
        _sum: sums({ commits: 2, issuesCompleted: 2, storyPoints: 6 }),
      });
      prisma.workItem.aggregate.mockResolvedValueOnce(items(1, 3, 1, 10)).mockResolvedValueOnce(items(0, null));
    });

    it('scopes members and narrows by manager with AND', async () => {
      await svc.summary(em, '2026-11-01', '2026-11-07', 'em2');
      expect(prisma.member.findMany.mock.calls[0][0].where).toEqual({
        managerId: { in: ['em1'] },
        AND: [{ managerId: 'em2' }],
      });
      expect(prisma.dailyMetric.groupBy.mock.calls[0][0].where).toEqual({
        memberId: { in: ['m1', 'm2'] },
        date: { gte: D('2026-11-01'), lte: D('2026-11-07') },
      });
      expect(prisma.workItem.aggregate.mock.calls[0][0].where).toEqual({
        date: { gte: D('2026-11-01'), lte: D('2026-11-07') },
        contributors: { some: { memberId: { in: ['m1', 'm2'] } } },
      });
    });

    it('counts shared work items once at team level but keeps per-person credit in rows', async () => {
      const out = await svc.summary(em, '2026-11-01', '2026-11-07');
      expect(out.totals).toEqual({ ...ZERO, commits: 2, issuesCompleted: 1, storyPoints: 3, cycleTimeHoursAvg: 10 });
      expect(out.previous).toEqual({ ...ZERO, commits: 2, issuesCompleted: 0, storyPoints: 0 });
      expect(out.rows).toEqual([
        {
          memberId: 'm1',
          memberName: 'Nour',
          managerName: 'Hana',
          totals: { ...ZERO, commits: 2, issuesCompleted: 1, storyPoints: 3 },
        },
        { memberId: 'm2', memberName: 'Omar', managerName: 'Hana', totals: ZERO },
      ]);
    });
  });

  describe('rollup', () => {
    const tl = { id: 'tl1', name: 'Tamer', tribeName: 'Payments' };
    beforeEach(() => {
      prisma.member.findMany.mockResolvedValue([
        { id: 'm1', manager: { id: 'em1', name: 'Hana', reportsTo: tl } },
        { id: 'm2', manager: { id: 'em1', name: 'Hana', reportsTo: tl } },
        { id: 'm3', manager: { id: 'em2', name: 'Adam', reportsTo: tl } },
        { id: 'm4', manager: { id: 'em3', name: 'Ziad', reportsTo: null } },
      ]);
      prisma.dailyMetric.groupBy.mockImplementation(async ({ by }) =>
        by[0] === 'memberId'
          ? [
              { memberId: 'm1', _sum: sums({ commits: 1, holdHoursSum: 6, holdSamples: 1 }) },
              { memberId: 'm2', _sum: sums({ commits: 2, holdHoursSum: 3, holdSamples: 2 }) },
              { memberId: 'm3', _sum: sums({ commits: 4 }) },
            ]
          : [{ date: D('2026-11-02'), _sum: sums({ commits: 7, issuesCompleted: 5 }) }],
      );
      prisma.workItem.groupBy.mockResolvedValue([{ date: D('2026-11-02'), ...items(2, 5) }]);
      prisma.workItem.aggregate.mockImplementation(async ({ where }) =>
        items(where.contributors.some.memberId.in.length, 1),
      );
    });

    it('groups by manager with tribe subtitles, sorted by name, averaging hold time across members', async () => {
      const out = await svc.rollup(em, 'manager', '2026-11-01', '2026-11-03');
      expect(scope.memberWhere).toHaveBeenCalledWith(em);
      expect(out.groupBy).toBe('manager');
      expect(out.rows.map((r) => [r.id, r.name, r.subtitle, r.memberCount])).toEqual([
        ['em2', 'Adam', 'Payments', 1],
        ['em1', 'Hana', 'Payments', 2],
        ['em3', 'Ziad', null, 1],
      ]);
      const hana = out.rows.find((r) => r.id === 'em1')!;
      expect(hana.totals).toMatchObject({ commits: 3, holdTimeHoursAvg: 3, issuesCompleted: 2, storyPoints: 1 });
      const ziad = out.rows.find((r) => r.id === 'em3')!;
      expect(ziad.totals).toMatchObject({ commits: 0, holdTimeHoursAvg: null, issuesCompleted: 1 });
    });

    it('groups by tribe with an Unassigned bucket for managers without a tribe lead', async () => {
      const out = await svc.rollup(em, 'tribe', '2026-11-01', '2026-11-03');
      expect(out.rows.map((r) => [r.id, r.name, r.subtitle, r.memberCount])).toEqual([
        ['tl1', 'Payments', 'Tamer', 3],
        ['unassigned', 'Unassigned', null, 1],
      ]);
      expect(out.rows[0].totals.commits).toBe(7);
    });

    it('builds a daily trend with de-duplicated work items', async () => {
      const out = await svc.rollup(em, 'manager', '2026-11-01', '2026-11-03');
      expect(out.trend).toHaveLength(3);
      expect(out.trend[0]).toEqual({ date: '2026-11-01', ...ZERO });
      expect(out.trend[1]).toMatchObject({ date: '2026-11-02', commits: 7, issuesCompleted: 2, storyPoints: 5 });
    });
  });
});
