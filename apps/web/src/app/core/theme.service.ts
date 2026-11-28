import { Injectable, computed, signal } from '@angular/core';

const KEY = 'cadence-theme';
export type Theme = 'cadence' | 'cadence-dark';

/** Applies a theme instantly: suspends CSS transitions while the theme attribute flips. */
function applyThemeInstantly(theme: string) {
  const root = document.documentElement;
  root.setAttribute('data-theme-switching', '');
  root.dataset['theme'] = theme;
  void getComputedStyle(root).color; // flush styles while transitions are off
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.removeAttribute('data-theme-switching')),
  );
}

/**
 * Current daisyUI theme. The initial value comes from the `data-theme` attribute, which an inline script in
 * `index.html` sets from `localStorage` before Angular boots; changes are written back to `localStorage`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>((document.documentElement.dataset['theme'] as Theme) ?? 'cadence');
  readonly isDark = computed(() => this.theme() === 'cadence-dark');

  toggle() {
    this.set(this.theme() === 'cadence' ? 'cadence-dark' : 'cadence');
  }

  /** Switches theme without transition flicker and persists the choice. */
  set(theme: Theme) {
    this.theme.set(theme);
    applyThemeInstantly(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }
}
