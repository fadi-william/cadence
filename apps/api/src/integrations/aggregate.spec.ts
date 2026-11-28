import { aggregate, workItems } from './aggregate';

describe('aggregate', () => {
  const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') };

  it('sums counters per member and day and averages cycle time inputs', () => {
    const rows = aggregate(
      [
        { memberId: 'm1', date: '2026-11-01', commits: 2 },
        { memberId: 'm1', date: '2026-11-01', commits: 1, prsReviewed: 1 },
        { memberId: 'm1', date: '2026-11-02', issuesCompleted: 1, storyPoints: 3, cycleTimeHours: [10] },
        { memberId: 'm1', date: '2026-11-02', issuesCompleted: 1, storyPoints: 2, cycleTimeHours: [20] },
        { memberId: 'm2', date: '2026-11-01', prsRaised: 1 },
      ],
      range,
    );
    const m1d1 = rows.find((r) => r.memberId === 'm1' && r.date.toISOString().startsWith('2026-11-01'))!;
    const m1d2 = rows.find((r) => r.memberId === 'm1' && r.date.toISOString().startsWith('2026-11-02'))!;
    expect(rows).toHaveLength(3);
    expect(m1d1).toMatchObject({ commits: 3, prsReviewed: 1 });
    expect(m1d2).toMatchObject({ issuesCompleted: 2, storyPoints: 5, cycleTimeHoursSum: 30, cycleTimeSamples: 2 });
  });

  it('drops activity outside the range', () => {
    expect(aggregate([{ memberId: 'm1', date: '2026-10-31', commits: 5 }], range)).toEqual([]);
  });

  it('collects each completed work item once with everyone credited for it', () => {
    const items = workItems(
      [
        {
          memberId: 'm1',
          date: '2026-11-02',
          workItemKey: 'CORE-1',
          issuesCompleted: 1,
          storyPoints: 3,
          cycleTimeHours: [10],
        },
        {
          memberId: 'm2',
          date: '2026-11-02',
          workItemKey: 'CORE-1',
          issuesCompleted: 1,
          storyPoints: 3,
          cycleTimeHours: [10],
        },
        { memberId: 'm1', date: '2026-10-31', workItemKey: 'CORE-0', issuesCompleted: 1 },
        { memberId: 'm1', date: '2026-11-01', commits: 4 },
      ],
      range,
    );
    expect(items).toEqual([
      {
        key: 'CORE-1',
        date: new Date('2026-11-02T00:00:00.000Z'),
        storyPoints: 3,
        cycleTimeHours: 10,
        memberIds: new Set(['m1', 'm2']),
      },
    ]);
  });
});
