import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DoraRating } from '@cadence/shared';
import { Icon } from './icon';
import { RatingBadge } from './rating-badge';

/** Ring fill (percent) and colour for each DORA rating; unrated metrics show an empty ring. */
const LEVEL: Record<DoraRating, { pct: number; color: string }> = {
  ELITE: { pct: 100, color: 'var(--color-success)' },
  HIGH: { pct: 75, color: 'var(--color-info)' },
  MEDIUM: { pct: 50, color: 'var(--color-warning)' },
  LOW: { pct: 25, color: 'var(--color-error)' },
};

/**
 * One delivery metric tile: daisyUI radial-progress showing the DORA performance level, value and rating
 * badge.
 *
 * @remarks
 * Inputs: `label`, preformatted `value`, `icon` name, optional `rating` (`null` = not enough data) and a
 * small `hint` line under the value. Set `rated` to `false` for a metric that has no DORA rating (e.g.
 * review wait): the ring becomes a plain icon bubble and the rating badge is hidden, so the `hint` carries
 * the context instead.
 */
@Component({
  selector: 'app-dora-tile',
  imports: [Icon, RatingBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'surface flex items-center gap-4 p-4 sm:p-5' },
  templateUrl: './dora-tile.html',
})
export class DoraTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly icon = input.required<string>();
  readonly rating = input<DoraRating | null>(null);
  readonly hint = input<string>();
  /** Whether the metric has a DORA rating; `false` hides the rating ring and badge. */
  readonly rated = input(true);
  protected readonly level = computed(() => {
    const r = this.rating();
    return r ? LEVEL[r] : { pct: 0, color: 'var(--color-base-300)' };
  });
}

/**
 * Subtext for a review-wait figure: the sample size behind the median, or a note that there is none.
 *
 * @param hoursMedian - Median review wait in hours; `null` when no PR was reviewed.
 * @param pullRequests - Number of pull requests behind the median.
 * @param prefix - Leading word, e.g. `"Median"` on a tile or `"median"` mid-sentence.
 * @returns For example `"Median, 42 PRs"`, or `"No reviewed PRs"`.
 */
export const reviewWaitHint = (
  hoursMedian: number | null,
  pullRequests: number,
  prefix = 'Median',
): string =>
  hoursMedian === null || pullRequests === 0
    ? 'No reviewed PRs'
    : `${prefix}, ${pullRequests} ${pullRequests === 1 ? 'PR' : 'PRs'}`;

/** Inputs for one `<app-dora-tile>`, as built by {@link doraKpis}. */
export interface DoraKpi {
  label: string;
  icon: string;
  value: string;
  hint: string;
  /** DORA rating; `null` when there is not enough data, or when the metric is not rated. */
  rating: DoraRating | null;
  /** `false` for a metric outside DORA that never has a rating (see {@link DoraTile.rated}). */
  rated: boolean;
}

/**
 * Builds the delivery tiles from a DORA summary, ready to spread into `<app-dora-tile>` inputs: the four
 * DORA key metrics (frequency, lead time, change failure rate, time to restore) plus an unrated
 * "Review wait" tile right after lead time.
 *
 * @param d - The DORA summary; `changeFailureRate` is a 0-1 fraction and durations are in hours.
 * @param fmtHours - Formatter for the hour values (`null` means no samples).
 * @returns The tiles in display order.
 */
export const doraKpis = (
  d: {
    deploymentsPerDay: number;
    deployments: number;
    failedDeployments: number;
    leadTimeHoursMedian: number | null;
    changeFailureRate: number | null;
    mttrHours: number | null;
    reviewWaitHoursMedian: number | null;
    reviewedPullRequests: number;
    ratings: Record<
      'deploymentFrequency' | 'leadTime' | 'changeFailureRate' | 'mttr',
      DoraRating | null
    >;
  },
  fmtHours: (h: number | null) => string,
): DoraKpi[] => [
  {
    label: 'Deployment frequency',
    icon: 'rocket',
    value: `${d.deploymentsPerDay}/day`,
    hint: `${d.deployments - d.failedDeployments} successful deploys`,
    rating: d.ratings.deploymentFrequency,
    rated: true,
  },
  {
    label: 'Lead time for changes',
    icon: 'clock',
    value: fmtHours(d.leadTimeHoursMedian),
    hint: 'Median, commit → production',
    rating: d.ratings.leadTime,
    rated: true,
  },
  {
    label: 'Review wait',
    icon: 'hourglass',
    value: fmtHours(d.reviewWaitHoursMedian),
    hint: reviewWaitHint(d.reviewWaitHoursMedian, d.reviewedPullRequests),
    rating: null,
    rated: false,
  },
  {
    label: 'Change failure rate',
    icon: 'shield',
    value: d.changeFailureRate === null ? '—' : `${Math.round(d.changeFailureRate * 100)}%`,
    hint: `${d.failedDeployments} of ${d.deployments} failed`,
    rating: d.ratings.changeFailureRate,
    rated: true,
  },
  {
    label: 'Time to restore',
    icon: 'refresh',
    value: fmtHours(d.mttrHours),
    hint: 'Median, failure → fix',
    rating: d.ratings.mttr,
    rated: true,
  },
];
