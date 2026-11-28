import { TestBed } from '@angular/core/testing';
import { StatCard } from './stat-card';

describe('StatCard', () => {
  const render = async (inputs: Record<string, unknown>) => {
    const fixture = TestBed.createComponent(StatCard);
    const all = { label: 'Commits', value: 42, icon: 'commit', ...inputs };
    for (const [k, v] of Object.entries(all)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector('.badge') as HTMLElement | null;
    return {
      el,
      badge,
      delta: badge?.textContent?.trim() ?? null,
      paths: [...el.querySelectorAll('svg[viewBox="0 0 100 32"] path')].map((p) =>
        p.getAttribute('d'),
      ),
    };
  };

  it('renders label, value and hint', async () => {
    const { el } = await render({ hint: 'this week' });
    expect(el.textContent).toContain('Commits');
    expect(el.textContent).toContain('42');
    expect(el.textContent).toContain('this week');
  });

  it('shows no delta without both periods', async () => {
    expect((await render({ current: 5 })).badge).toBeNull();
    expect((await render({ previous: 5 })).badge).toBeNull();
    expect((await render({ current: 0, previous: 0 })).badge).toBeNull();
  });

  it('labels growth from zero as "new"', async () => {
    const { delta, badge } = await render({ current: 3, previous: 0 });
    expect(delta).toBe('new');
    expect(badge!.className).toContain('text-success');
  });

  it('shows a rounded percentage change coloured by direction', async () => {
    const up = await render({ current: 15, previous: 10 });
    expect(up.delta).toBe('+50%');
    expect(up.badge!.className).toContain('text-success');

    const down = await render({ current: 2, previous: 3 });
    expect(down.delta).toBe('-33%');
    expect(down.badge!.className).toContain('text-error');

    const flat = await render({ current: 10, previous: 10 });
    expect(flat.delta).toBe('+0%');
  });

  it('inverts the colour when lower is better', async () => {
    const down = await render({ current: 5, previous: 10, invert: true });
    expect(down.delta).toBe('-50%');
    expect(down.badge!.className).toContain('text-success');
    const up = await render({ current: 20, previous: 10, invert: true });
    expect(up.badge!.className).toContain('text-error');
  });

  it('draws no sparkline for fewer than two points', async () => {
    expect((await render({ series: [] })).paths).toEqual([]);
    expect((await render({ series: [3] })).paths).toEqual([]);
  });

  it('scales the sparkline to the series maximum', async () => {
    const { paths } = await render({ series: [0, 5, 10] });
    const line = 'M0.0,30.0 L50.0,17.0 L100.0,4.0';
    expect(paths).toEqual([`${line} L100,32 L0,32 Z`, line]);
  });

  it('keeps an all-zero sparkline on the baseline', async () => {
    const { paths } = await render({ series: [0, 0] });
    expect(paths[1]).toBe('M0.0,30.0 L100.0,30.0');
  });
});
