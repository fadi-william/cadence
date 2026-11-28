import { toDay } from '../common/http/http';
import type { ActivityRecord, DateRange } from './adapters/adapter.types';

/**
 * One row per completed work item with everyone credited for it, so team totals can count it once.
 * Takes story points and cycle time from the first record of each key (they are the same per item).
 * Only records with a `workItemKey` and a date inside the range are considered.
 *
 * @returns Rows dated at UTC midnight of the item's completion day, with `cycleTimeHours` null when the
 * first record had no sample.
 */
export function workItems(records: ActivityRecord[], range: DateRange) {
  const from = toDay(range.from);
  const to = toDay(range.to);
  const items = new Map<
    string,
    { key: string; date: Date; storyPoints: number; cycleTimeHours: number | null; memberIds: Set<string> }
  >();
  for (const r of records) {
    if (!r.workItemKey || r.date < from || r.date > to) continue;
    let item = items.get(r.workItemKey);
    if (!item) {
      item = {
        key: r.workItemKey,
        date: new Date(`${r.date}T00:00:00.000Z`),
        storyPoints: r.storyPoints ?? 0,
        cycleTimeHours: r.cycleTimeHours?.[0] ?? null,
        memberIds: new Set(),
      };
      items.set(r.workItemKey, item);
    }
    item.memberIds.add(r.memberId);
  }
  return [...items.values()];
}

/**
 * One row per pull request that got its first review in the range, from records with a `pullRequestKey`.
 * The first record of each key wins (adapters emit one per PR).
 *
 * @returns Rows dated at UTC midnight of the first review day.
 */
export function reviewedPullRequests(records: ActivityRecord[], range: DateRange) {
  const from = toDay(range.from);
  const to = toDay(range.to);
  const prs = new Map<string, { key: string; memberId: string; date: Date; waitHours: number }>();
  for (const r of records) {
    if (!r.pullRequestKey || r.reviewWaitHours === undefined || r.date < from || r.date > to) continue;
    if (prs.has(r.pullRequestKey)) continue;
    prs.set(r.pullRequestKey, {
      key: r.pullRequestKey,
      memberId: r.memberId,
      date: new Date(`${r.date}T00:00:00.000Z`),
      waitHours: Math.round(r.reviewWaitHours * 100) / 100,
    });
  }
  return [...prs.values()];
}

/**
 * Sums activity per member/day into `DailyMetric`-shaped rows. Records outside the range are dropped.
 * Cycle and hold times are kept as a sum plus a sample count so averages can be combined across days.
 */
export function aggregate(records: ActivityRecord[], range: DateRange) {
  const from = toDay(range.from);
  const to = toDay(range.to);
  const acc = new Map<
    string,
    {
      memberId: string;
      date: Date;
      commits: number;
      prsRaised: number;
      prsReviewed: number;
      prsMerged: number;
      issuesCompleted: number;
      storyPoints: number;
      cycleTimeHoursSum: number;
      cycleTimeSamples: number;
      assignmentsCompleted: number;
      assignmentsHandedOver: number;
      assignmentsReworked: number;
      holdHoursSum: number;
      holdSamples: number;
    }
  >();
  for (const r of records) {
    if (r.date < from || r.date > to) continue;
    const key = `${r.memberId}|${r.date}`;
    let row = acc.get(key);
    if (!row) {
      row = {
        memberId: r.memberId,
        date: new Date(`${r.date}T00:00:00.000Z`),
        commits: 0,
        prsRaised: 0,
        prsReviewed: 0,
        prsMerged: 0,
        issuesCompleted: 0,
        storyPoints: 0,
        cycleTimeHoursSum: 0,
        cycleTimeSamples: 0,
        assignmentsCompleted: 0,
        assignmentsHandedOver: 0,
        assignmentsReworked: 0,
        holdHoursSum: 0,
        holdSamples: 0,
      };
      acc.set(key, row);
    }
    row.commits += r.commits ?? 0;
    row.prsRaised += r.prsRaised ?? 0;
    row.prsReviewed += r.prsReviewed ?? 0;
    row.prsMerged += r.prsMerged ?? 0;
    row.issuesCompleted += r.issuesCompleted ?? 0;
    row.storyPoints += r.storyPoints ?? 0;
    for (const h of r.cycleTimeHours ?? []) {
      row.cycleTimeHoursSum += h;
      row.cycleTimeSamples += 1;
    }
    row.assignmentsCompleted += r.assignmentsCompleted ?? 0;
    row.assignmentsHandedOver += r.assignmentsHandedOver ?? 0;
    row.assignmentsReworked += r.assignmentsReworked ?? 0;
    for (const h of r.holdHours ?? []) {
      row.holdHoursSum += h;
      row.holdSamples += 1;
    }
  }
  return [...acc.values()];
}
