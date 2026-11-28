import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { PROVIDER_LABELS, type MemberSourceTotals, type MetricTotals } from '@cadence/shared';
import { ApiService } from '../../core/api.service';
import { DateRange, fmtHours, lastNDays, shortDay } from '../../core/dates';
import { ActivityCalendar } from '../../shared/activity-calendar';
import { Avatar } from '../../shared/avatar';
import { BrandArcs } from '../../shared/brand-arcs';
import { Chart, ChartSpec } from '../../shared/chart';
import { DateRangePicker } from '../../shared/date-range';
import { reviewWaitHint } from '../../shared/dora-tile';
import { Icon } from '../../shared/icon';
import { ProviderIcon } from '../../shared/provider-icon';
import { StatCard } from '../../shared/stat-card';
import { TILE_GRID, tileSpan } from '../../shared/tile-grid';

/** Count of "things done" used for the combined activity score and platform share. */
const activity = (
  t: Pick<MetricTotals, 'commits' | 'prsRaised' | 'prsReviewed' | 'issuesCompleted'>,
) => t.commits + t.prsRaised + t.prsReviewed + t.issuesCompleted;

/**
 * The figures shown on a per-connection card: work-tracking stats, code stats, or both, depending on what
 * the connection collected for the member. A connection with no data yet shows its provider's usual group
 * (work stats for Jira, code stats otherwise), so an Azure DevOps connection with Azure Boards shows both.
 */
function sourceNumbers(s: MemberSourceTotals) {
  const t = s.totals;
  const work = [
    { label: 'Issues', value: t.issuesCompleted },
    { label: 'Points', value: t.storyPoints },
    { label: 'Cycle', value: fmtHours(t.cycleTimeHoursAvg) },
    { label: 'Assignments', value: t.assignmentsCompleted },
    { label: 'Hold', value: fmtHours(t.holdTimeHoursAvg) },
    { label: 'Rework', value: t.assignmentsReworked },
  ];
  const code = [
    { label: 'Commits', value: t.commits },
    { label: 'PRs', value: t.prsRaised },
    { label: 'Reviews', value: t.prsReviewed },
  ];
  const hasWork = t.issuesCompleted + t.assignmentsCompleted + t.assignmentsHandedOver > 0;
  const hasCode = t.commits + t.prsRaised + t.prsReviewed + t.prsMerged > 0;
  if (hasWork && hasCode) return [...work, ...code];
  if (hasWork) return work;
  if (hasCode) return code;
  return s.provider === 'JIRA' ? work : code;
}

/**
 * One combined view of an individual: Azure DevOps + Jira merged into a single scorecard and timeline.
 *
 * @remarks
 * Renders KPI cards (vs the previous period; review wait is the median wait for a first review on the
 * member's own PRs, where lower is better), a daily activity timeline and a per-connection breakdown
 * for the selected range, plus a six-month activity calendar that ignores the date picker.
 */
@Component({
  selector: 'app-member-detail-page',
  imports: [
    RouterLink,
    ActivityCalendar,
    Avatar,
    BrandArcs,
    Chart,
    DateRangePicker,
    Icon,
    ProviderIcon,
    StatCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './member-detail.page.html',
})
export class MemberDetailPage {
  private readonly api = inject(ApiService);
  /** Member id, bound from the `:id` route param. */
  readonly id = input.required<string>();
  protected readonly labels = PROVIDER_LABELS;
  protected readonly range = signal<DateRange>(lastNDays(30));
  protected readonly tileGrid = TILE_GRID;
  protected readonly tileSpan = tileSpan;

  protected readonly member = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.member(params),
  });
  protected readonly metrics = resource({
    params: () => ({ id: this.id(), ...this.range() }),
    loader: ({ params }) => this.api.memberMetrics(params.id, params.from, params.to),
  });
  /** Fixed ~six-month (182-day) window feeding the activity calendar. */
  private readonly sixMonths = resource({
    params: () => ({ id: this.id(), ...lastNDays(182) }),
    loader: ({ params }) => this.api.memberMetrics(params.id, params.from, params.to),
  });

  private readonly days = computed(() => this.metrics.value()?.days ?? []);

  protected readonly kpis = computed(() => {
    const m = this.metrics.value();
    if (!m) return [];
    const t = m.totals;
    const p = m.previous;
    const d = this.days();
    return [
      {
        label: 'Commits',
        icon: 'commit',
        color: 'primary' as const,
        value: t.commits,
        current: t.commits,
        previous: p.commits,
        invert: false,
        hint: 'Azure DevOps',
        series: d.map((x) => x.commits),
      },
      {
        label: 'Pull requests',
        icon: 'merge',
        color: 'secondary' as const,
        value: `${t.prsMerged} / ${t.prsRaised}`,
        current: t.prsMerged,
        previous: p.prsMerged,
        invert: false,
        hint: 'merged / raised',
        series: d.map((x) => x.prsMerged),
      },
      {
        label: 'Reviews',
        icon: 'eye',
        color: 'accent' as const,
        value: t.prsReviewed,
        current: t.prsReviewed,
        previous: p.prsReviewed,
        invert: false,
        hint: 'PRs reviewed for others',
        series: d.map((x) => x.prsReviewed),
      },
      {
        label: 'Issues done',
        icon: 'ticket',
        color: 'info' as const,
        value: t.issuesCompleted,
        current: t.issuesCompleted,
        previous: p.issuesCompleted,
        invert: false,
        hint: `${t.storyPoints} pts · cycle ${fmtHours(t.cycleTimeHoursAvg)}`,
        series: d.map((x) => x.issuesCompleted),
      },
      {
        label: 'Review wait',
        icon: 'hourglass',
        color: 'warning' as const,
        value: fmtHours(m.reviewWait.hoursMedian),
        current: m.reviewWait.hoursMedian,
        previous: m.reviewWait.previousHoursMedian,
        invert: true,
        hint: reviewWaitHint(m.reviewWait.hoursMedian, m.reviewWait.pullRequests, 'median'),
        series: [] as number[],
      },
    ];
  });

  protected readonly timeline = computed<ChartSpec>(() => ({
    categories: this.days().map((d) => shortDay(d.date)),
    series: [
      {
        name: 'Commits',
        type: 'bar',
        data: this.days().map((d) => d.commits),
        color: 'primary',
        stack: 'code',
      },
      {
        name: 'PRs raised',
        type: 'bar',
        data: this.days().map((d) => d.prsRaised),
        color: 'secondary',
        stack: 'code',
      },
      {
        name: 'Reviews',
        type: 'bar',
        data: this.days().map((d) => d.prsReviewed),
        color: 'accent',
        stack: 'code',
      },
      {
        name: 'Issues done',
        type: 'line',
        data: this.days().map((d) => d.issuesCompleted),
        color: 'info',
        area: true,
      },
    ],
  }));

  /**
   * Per-connection breakdown: each source's share (percent) of the member's total activity, plus the
   * figures that connection collected (see {@link sourceNumbers}).
   */
  protected readonly sources = computed(() => {
    const list: MemberSourceTotals[] = this.metrics.value()?.sources ?? [];
    const total = Math.max(
      1,
      list.reduce((n, s) => n + activity(s.totals), 0),
    );
    return list.map((s) => ({
      ...s,
      share: Math.round((activity(s.totals) / total) * 100),
      numbers: sourceNumbers(s),
    }));
  });

  protected readonly calendar = computed(() =>
    this.sixMonths.value()?.days.map((d) => ({ date: d.date, value: activity(d) })),
  );
}
