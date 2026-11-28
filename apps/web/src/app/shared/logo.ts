import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Cadence mark: an open "C" holding rhythm bars, with a champagne "beat" dot.
 * Inline SVG (crisp at any size, no extra request); `public/logo.svg` is the same artwork for the favicon.
 * `size` is the mark's edge in px; the "Cadence" wordmark (and optional `tagline`) is shown unless
 * `wordmark` is false.
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2.5' },
  templateUrl: './logo.html',
})
export class Logo {
  readonly size = input(40);
  readonly wordmark = input(true);
  /** White text, for wine/dark backgrounds. */
  readonly inverse = input(false);
  readonly tagline = input<string>();
  /** Per-instance gradient id, so several logos on one page don't share one `<linearGradient>`. */
  protected readonly gid = `cadence-logo-${Math.random().toString(36).slice(2, 8)}`;
}
