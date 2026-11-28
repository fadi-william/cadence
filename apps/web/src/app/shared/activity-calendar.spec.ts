import { TestBed } from '@angular/core/testing';
import { ActivityCalendar, CalendarDay } from './activity-calendar';

describe('ActivityCalendar', () => {
  const render = async (days: CalendarDay[]) => {
    const fixture = TestBed.createComponent(ActivityCalendar);
    fixture.componentRef.setInput('days', days);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const grid = el.querySelector('[role="img"]')!;
    return {
      fixture,
      cmp: fixture.componentInstance,
      grid,
      cells: [...grid.children] as HTMLElement[],
    };
  };

  it('renders nothing for an empty range', async () => {
    const { cells, grid } = await render([]);
    expect(cells).toHaveLength(0);
    expect(grid.getAttribute('aria-label')).toBe('Activity calendar, 0 contributions');
  });

  it('pads the first week so Monday is the first row', async () => {
    // 2024-01-03 is a Wednesday → two blank cells (Mon, Tue)
    const { cells } = await render([
      { date: '2024-01-03', value: 1 },
      { date: '2024-01-04', value: 0 },
    ]);
    expect(cells).toHaveLength(4);
    expect(cells[0].getAttribute('title')).toBeNull();
    expect(cells[1].getAttribute('title')).toBeNull();
    expect(cells[2].getAttribute('title')).toBe('2024-01-03: 1 contributions');
  });

  it('does not pad when the range starts on a Monday, pads 6 for Sunday', async () => {
    expect((await render([{ date: '2024-01-01', value: 0 }])).cells).toHaveLength(1);
    expect((await render([{ date: '2024-01-07', value: 0 }])).cells).toHaveLength(7);
  });

  it('totals contributions in the aria label', async () => {
    const { grid } = await render([
      { date: '2024-01-01', value: 2 },
      { date: '2024-01-02', value: 3 },
    ]);
    expect(grid.getAttribute('aria-label')).toBe('Activity calendar, 5 contributions');
  });

  it('shades by value relative to the maximum', async () => {
    const { cmp } = await render([
      { date: '2024-01-01', value: 0 },
      { date: '2024-01-02', value: 4 },
    ]);
    expect(cmp.shade(0)).toBe('var(--color-base-300)');
    expect(cmp.shade(-1)).toBe('var(--color-base-300)');
    expect(cmp.shade(4)).toContain('var(--color-primary) 100%');
    expect(cmp.shade(2)).toContain('var(--color-primary) 60%');
    expect(cmp.shade(1)).toContain('var(--color-primary) 40%');
  });

  it('treats an all-zero range as max 1', async () => {
    const { cmp } = await render([{ date: '2024-01-01', value: 0 }]);
    expect(cmp.shade(1)).toContain('100%');
  });
});
