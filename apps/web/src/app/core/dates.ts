/** Formats a date as its UTC calendar day, `YYYY-MM-DD`. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Inclusive date range of ISO days (`YYYY-MM-DD`), as sent to the metrics and DORA endpoints. */
export interface DateRange {
  from: string;
  to: string;
}

/** The `n` days ending today, inclusive of today (so `lastNDays(7)` spans 7 calendar days, UTC). */
export function lastNDays(n: number): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - (n - 1) * 864e5);
  return { from: isoDay(from), to: isoDay(to) };
}

/** Presets offered by the date-range picker; `days` feeds {@link lastNDays}. */
export const RANGE_OPTIONS = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 180, label: 'Last 6 months' },
];

/** Formats an ISO day as a short localized label (e.g. "Mar 4"), interpreted in UTC so it never shifts. */
export const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Formats a duration given in hours: minutes below 1 h, hours below 48 h, otherwise days.
 * Returns an em dash for `null`/`undefined` (no samples).
 */
export const fmtHours = (h: number | null | undefined) => {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
};
