import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Warm, wine-friendly gradient pairs; one is picked deterministically from the name. */
const GRADIENTS = [
  ['#e0577f', '#8e1838'], // rosé → wine
  ['#c0763f', '#7a2e17'], // copper
  ['#a456b8', '#55206b'], // plum
  ['#d4a24c', '#8a5a14'], // champagne gold
  ['#4f9aa0', '#1f5a63'], // teal (contrast)
  ['#d8636b', '#8b2433'], // garnet
  ['#7a7fd0', '#3c3f8e'], // indigo (contrast)
  ['#b7577f', '#5c1d3f'], // berry
];

/**
 * Gradient avatar with white initials (daisyUI avatar-placeholder). Initials come from the first two words
 * of `name` (an email's domain is dropped first); `size` is in px. The same name always gets the same
 * gradient.
 */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  templateUrl: './avatar.html',
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(36);

  protected readonly initials = computed(() => {
    const parts = this.name()
      .replace(/@.*$/, '')
      .split(/[\s._-]+/)
      .filter(Boolean);
    return (
      parts
        .slice(0, 2)
        .map((p) => p[0]!.toUpperCase())
        .join('') || '?'
    );
  });

  protected readonly gradient = computed(() => {
    let h = 0;
    for (const c of this.name()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [from, to] = GRADIENTS[h % GRADIENTS.length];
    return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
  });
}
