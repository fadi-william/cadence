import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Decorative concentric open arcs that echo the logo's "C".
 * Place inside a `relative overflow-hidden` container; `size` is the drawing's width in px.
 */
@Component({
  selector: 'app-brand-arcs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pointer-events-none absolute inset-0 overflow-hidden', 'aria-hidden': 'true' },
  templateUrl: './brand-arcs.html',
})
export class BrandArcs {
  readonly size = input(420);
  protected readonly radii = [70, 112, 154];

  /** SVG path (400×400 viewBox) for an open ring from -45° round to +45° (gap on the right), like the logo. */
  arc(r: number) {
    const c = 200;
    const d = r * Math.SQRT1_2;
    return `M${(c + d).toFixed(1)} ${(c - d).toFixed(1)}A${r} ${r} 0 1 0 ${(c + d).toFixed(1)} ${(c + d).toFixed(1)}`;
  }
}
