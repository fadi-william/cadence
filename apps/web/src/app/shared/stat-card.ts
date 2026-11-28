import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from './icon';
import type { ColorToken } from './chart';

/**
 * KPI card: icon bubble, value, delta vs previous period and an inline SVG sparkline.
 *
 * @remarks
 * `value` is displayed as given; the delta badge is computed from the raw `current` and `previous`
 * numbers (hidden when either is `null` or both are zero, "new" when only the previous one is zero). The
 * sparkline draws `series` when it has at least two points.
 */
@Component({
  selector: 'app-stat-card',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'surface surface-interactive block p-5' },
  templateUrl: './stat-card.html',
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly icon = input.required<string>();
  readonly color = input<ColorToken>('primary');
  readonly hint = input<string>();
  readonly current = input<number | null>(null);
  readonly previous = input<number | null>(null);
  /** Set when lower is better (e.g. cycle time). */
  readonly invert = input(false);
  readonly series = input<number[]>([]);

  protected readonly delta = computed(() => {
    const c = this.current();
    const p = this.previous();
    if (c === null || p === null || (c === 0 && p === 0)) return null;
    if (p === 0) return { up: true, label: 'new', cls: 'bg-success/15 text-success' };
    const pct = Math.round(((c - p) / p) * 100);
    const up = pct >= 0;
    const good = this.invert() ? !up : up;
    return {
      up,
      label: `${up ? '+' : ''}${pct}%`,
      cls: good ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
    };
  });

  protected readonly path = computed(() => {
    const s = this.series();
    if (s.length < 2) return null;
    const max = Math.max(1, ...s);
    const pts = s.map((v, i) => [(i / (s.length - 1)) * 100, 30 - (v / max) * 26] as const);
    const line = pts
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    return { line, area: `${line} L100,32 L0,32 Z` };
  });
}
