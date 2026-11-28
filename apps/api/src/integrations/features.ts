import { BadRequestException } from '@nestjs/common';
import { IntegrationKind } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';

/**
 * Which `DailyMetric` columns each capability writes. Deployments have their own tables, so they have no
 * columns here.
 *
 * @remarks
 * Syncs only rewrite the columns of a connection's enabled capabilities, and turning a capability off with
 * "remove data" zeroes its columns. Keeping both behaviours on one list means they can never disagree.
 */
export const METRIC_COLUMNS = {
  [IntegrationKind.SOURCE_CONTROL]: ['commits', 'prsRaised', 'prsReviewed', 'prsMerged'],
  [IntegrationKind.WORK_TRACKING]: [
    'issuesCompleted',
    'storyPoints',
    'cycleTimeHoursSum',
    'cycleTimeSamples',
    'assignmentsCompleted',
    'assignmentsHandedOver',
    'assignmentsReworked',
    'holdHoursSum',
    'holdSamples',
  ],
} as const satisfies Partial<Record<IntegrationKind, readonly (keyof Prisma.DailyMetricUncheckedCreateInput)[]>>;

/** A capability that stores per-day metrics, i.e. one with an entry in {@link METRIC_COLUMNS}. */
export type MetricKind = keyof typeof METRIC_COLUMNS;

/** The metric columns written by the given capabilities. */
export const metricColumns = (kinds: Iterable<IntegrationKind>) =>
  [...kinds].flatMap((k) => (k in METRIC_COLUMNS ? METRIC_COLUMNS[k as MetricKind] : []));

/** `{ column: 0 }` for every metric column of the given capabilities, for clearing them in an update. */
export const zeroColumns = (kinds: Iterable<IntegrationKind>) =>
  Object.fromEntries(metricColumns(kinds).map((c) => [c, 0])) as Prisma.DailyMetricUpdateManyMutationInput;

/** Filter for `DailyMetric` rows whose every metric column is zero (empty rows left after clearing). */
export const emptyMetricRow = Object.fromEntries(
  metricColumns(Object.keys(METRIC_COLUMNS) as MetricKind[]).map((c) => [c, 0]),
) as Prisma.DailyMetricWhereInput;

/**
 * Checks a requested feature list against what the provider's adapter supports.
 *
 * @param features - Requested capabilities.
 * @param supported - The adapter's `describe().capabilities`.
 * @returns The features without duplicates, in the adapter's order.
 * @throws BadRequestException when the list is empty or names a capability the provider does not support
 */
export function validateFeatures(features: IntegrationKind[], supported: readonly IntegrationKind[]) {
  const unsupported = features.filter((f) => !supported.includes(f));
  if (unsupported.length) {
    throw new BadRequestException(`This provider does not support: ${unsupported.join(', ')}`);
  }
  if (!features.length) throw new BadRequestException('Enable at least one feature, or disable the connection');
  return supported.filter((s) => features.includes(s));
}
