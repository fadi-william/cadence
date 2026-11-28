const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a `YYYY-MM-DD` query value. Returns it when it is a real calendar date, or undefined so callers
 * fall back to their default range. Impossible dates such as 2026-13-01 or 2026-02-30 are dropped too.
 */
export function queryDate(value?: string): string | undefined {
  if (!value || !DATE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : undefined;
}
