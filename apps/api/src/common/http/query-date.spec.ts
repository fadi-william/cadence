import { queryDate } from './query-date';

describe('queryDate', () => {
  it.each(['2026-01-31', '2024-02-29', '2026-12-31'])('keeps the real date %s', (v) => {
    expect(queryDate(v)).toBe(v);
  });

  it.each([
    ['a missing value', undefined],
    ['an empty value', ''],
    ['another format', '31/01/2026'],
    ['a timestamp', '2026-01-31T10:00:00Z'],
    ['a month past 12', '2026-13-01'],
    ['a day past the end of the month', '2026-02-30'],
    ['a leap day outside a leap year', '2025-02-29'],
    ['day zero', '2026-01-00'],
  ])('drops %s', (_, v) => {
    expect(queryDate(v)).toBeUndefined();
  });
});
