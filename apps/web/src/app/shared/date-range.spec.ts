import { TestBed } from '@angular/core/testing';
import { lastNDays } from '../core/dates';
import { DateRangePicker } from './date-range';

describe('DateRangePicker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const render = async (range?: { from: string; to: string }) => {
    const fixture = TestBed.createComponent(DateRangePicker);
    if (range) fixture.componentRef.setInput('range', range);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const select = () => el.querySelector('select') as HTMLSelectElement;
    const dates = () => [...el.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
    return { fixture, cmp: fixture.componentInstance, el, select, dates };
  };

  it('defaults to the last 30 days preset', async () => {
    const { cmp, select, dates } = await render();
    expect(cmp.range()).toEqual(lastNDays(30));
    expect(select().value).toBe('30');
    expect(dates()).toHaveLength(0);
  });

  it('recognises a preset passed in', async () => {
    const { select } = await render(lastNDays(7));
    expect(select().value).toBe('7');
  });

  it('switches to custom for a non-preset range', async () => {
    const { select, dates } = await render({ from: '2024-01-01', to: '2024-01-31' });
    expect(select().value).toBe('0');
    expect(dates().map((d) => d.value)).toEqual(['2024-01-01', '2024-01-31']);
    expect(dates()[1].max).toBe('2024-06-15');
  });

  it('choosing a preset updates the range', async () => {
    const { cmp, fixture, select } = await render();
    select().value = '90';
    select().dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(cmp.range()).toEqual({ from: '2024-03-18', to: '2024-06-15' });
  });

  it('choosing custom keeps the range and reveals the inputs', async () => {
    const { cmp, fixture, select, dates } = await render();
    const before = cmp.range();
    select().value = '0';
    select().dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(cmp.range()).toEqual(before);
    expect(dates()).toHaveLength(2);
  });

  it('set() accepts only complete, ordered ranges', async () => {
    const { cmp } = await render({ from: '2024-01-01', to: '2024-01-31' });
    cmp.set('2024-02-01', '2024-01-31');
    expect(cmp.range()).toEqual({ from: '2024-01-01', to: '2024-01-31' });
    cmp.set('', '2024-01-31');
    expect(cmp.range()).toEqual({ from: '2024-01-01', to: '2024-01-31' });
    cmp.set('2024-01-10', '2024-01-10');
    expect(cmp.range()).toEqual({ from: '2024-01-10', to: '2024-01-10' });
  });

  it('editing a custom date input updates the range', async () => {
    const { cmp, fixture, dates } = await render({ from: '2024-01-01', to: '2024-01-31' });
    const from = dates()[0];
    from.value = '2024-01-15';
    from.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(cmp.range()).toEqual({ from: '2024-01-15', to: '2024-01-31' });
  });
});
