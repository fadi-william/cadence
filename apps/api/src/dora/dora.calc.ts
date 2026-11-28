import type { DoraRating } from '@cadence/shared';

/** The fields of a production deployment that the DORA calculations need. */
export interface DeploymentPoint {
  serviceId: string;
  status: 'SUCCESS' | 'FAILED';
  /** When the deployment run finished; deployments are bucketed and ordered by this. */
  finishedAt: Date;
  /** Hours from the built commit to the deployment; null when the commit time is unknown. */
  leadTimeHours: number | null;
}

/** Median of the values (mean of the two middle ones for an even count), or null for an empty list. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Rounds to one decimal place, passing null through. */
export const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/**
 * Time to restore: per service, from the first failed deployment of an incident to the next
 * successful deployment of the same service. Further failures before that success belong to the same
 * incident, and an incident with no later success is left out.
 *
 * @returns the median duration in hours, or null when no incident was restored
 */
export function timeToRestoreHours(deployments: DeploymentPoint[]): number | null {
  const byService = new Map<string, DeploymentPoint[]>();
  for (const d of deployments) byService.set(d.serviceId, [...(byService.get(d.serviceId) ?? []), d]);
  const durations: number[] = [];
  for (const list of byService.values()) {
    list.sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime());
    let failedAt: Date | null = null;
    for (const d of list) {
      if (d.status === 'FAILED' && !failedAt) failedAt = d.finishedAt;
      else if (d.status === 'SUCCESS' && failedAt) {
        durations.push((d.finishedAt.getTime() - failedAt.getTime()) / 36e5);
        failedAt = null;
      }
    }
  }
  return median(durations);
}

/**
 * DORA performance ratings for each metric. Thresholds follow the DORA State of DevOps performance clusters
 * (see docs/guide/metrics.md). Each function returns null when there is nothing to rate.
 */
export const rate = {
  /**
   * @param perDay - successful deployments per day: ELITE from 1, HIGH from 1/7 (weekly), MEDIUM from 1/30
   * @param deployments - number of successful deployments; 0 gives null (not LOW)
   */
  deploymentFrequency(perDay: number, deployments: number): DoraRating | null {
    if (!deployments) return null;
    if (perDay >= 1) return 'ELITE';
    if (perDay >= 1 / 7) return 'HIGH';
    if (perDay >= 1 / 30) return 'MEDIUM';
    return 'LOW';
  },
  /** Median lead time in hours: ELITE under a day, HIGH under a week, MEDIUM under 30 days. */
  leadTime(hours: number | null): DoraRating | null {
    if (hours === null) return null;
    if (hours < 24) return 'ELITE';
    if (hours < 24 * 7) return 'HIGH';
    if (hours < 24 * 30) return 'MEDIUM';
    return 'LOW';
  },
  /** Failed share of all deployments (0-1): ELITE up to 0.05, HIGH up to 0.1, MEDIUM up to 0.15. */
  changeFailureRate(rate: number | null): DoraRating | null {
    if (rate === null) return null;
    if (rate <= 0.05) return 'ELITE';
    if (rate <= 0.1) return 'HIGH';
    if (rate <= 0.15) return 'MEDIUM';
    return 'LOW';
  },
  /** Median time to restore in hours: ELITE under an hour, HIGH under a day, MEDIUM under a week. */
  mttr(hours: number | null): DoraRating | null {
    if (hours === null) return null;
    if (hours < 1) return 'ELITE';
    if (hours < 24) return 'HIGH';
    if (hours < 24 * 7) return 'MEDIUM';
    return 'LOW';
  },
};
