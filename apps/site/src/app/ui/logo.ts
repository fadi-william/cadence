// Kept in sync with apps/web/src/app/shared.
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Cadence mark: an open "C" holding rhythm bars, with a champagne "beat" dot.
 * Inline SVG (crisp at any size, no extra request); public/logo.svg is the same artwork for the favicon.
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2.5' },
  templateUrl: './logo.html',
})
export class Logo {
  /** Size of the square mark in CSS pixels; the wordmark text scales with it. */
  readonly size = input(40);
  /** Show the "Cadence" wordmark next to the mark. */
  readonly wordmark = input(true);
  /** White text, for wine/dark backgrounds. */
  readonly inverse = input(false);
  /** Optional small line under the wordmark (only shown with the wordmark). */
  readonly tagline = input<string>();
  /** Per-instance gradient id, so several logos on one page do not share an SVG id. */
  protected readonly gid = `cadence-logo-${Math.random().toString(36).slice(2, 8)}`;
}
