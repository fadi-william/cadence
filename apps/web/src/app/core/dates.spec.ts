import { RANGE_OPTIONS, fmtHours, isoDay, lastNDays, shortDay } from './dates';

describe('dates', () => {
  afterEach(() => vi.useRealTimers());

  describe('isoDay', () => {
    it('formats the UTC calendar day', () => {
      expect(isoDay(new Date('2024-01-02T10:00:00Z'))).toBe('2024-01-02');
      expect(isoDay(new Date('2024-12-31T23:59:59Z'))).toBe('2024-12-31');
    });
  });

  describe('lastNDays', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-10T12:00:00Z'));
    });

    it('returns an inclusive range ending today', () => {
      expect(lastNDays(7)).toEqual({ from: '2024-03-04', to: '2024-03-10' });
    });

    it('a 1-day range starts and ends today', () => {
      expect(lastNDays(1)).toEqual({ from: '2024-03-10', to: '2024-03-10' });
    });

    it('crosses month boundaries (leap year)', () => {
      expect(lastNDays(30)).toEqual({ from: '2024-02-10', to: '2024-03-10' });
    });
  });

  it('RANGE_OPTIONS are ascending presets', () => {
    const days = RANGE_OPTIONS.map((o) => o.days);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(days).toContain(30);
  });

  describe('shortDay', () => {
    it('renders the day independent of the local timezone', () => {
      const expected = new Date(Date.UTC(2024, 0, 5)).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
      expect(shortDay('2024-01-05')).toBe(expected);
      expect(shortDay('2024-01-05')).toMatch(/5/);
    });
  });

  describe('fmtHours', () => {
    it('renders a dash for missing values', () => {
      expect(fmtHours(null)).toBe('—');
      expect(fmtHours(undefined)).toBe('—');
    });
    it('uses minutes below one hour', () => {
      expect(fmtHours(0)).toBe('0 min');
      expect(fmtHours(0.5)).toBe('30 min');
      expect(fmtHours(0.999)).toBe('60 min');
    });
    it('uses hours below 48 h', () => {
      expect(fmtHours(1)).toBe('1.0 h');
      expect(fmtHours(47.94)).toBe('47.9 h');
    });
    it('uses days from 48 h', () => {
      expect(fmtHours(48)).toBe('2.0 d');
      expect(fmtHours(60)).toBe('2.5 d');
    });
  });
});
