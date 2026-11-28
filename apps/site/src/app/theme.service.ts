import { Injectable, computed, signal } from '@angular/core';

/** daisyUI theme names defined in styles.css. */
type Theme = 'cadence' | 'cadence-dark';

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
 * Light/dark theme switch. An inline script in index.html picks the initial theme (the saved choice,
 * else `prefers-color-scheme`) and sets `data-theme` on `<html>` before Angular boots; this service
 * starts from that attribute and persists each toggle to localStorage (`cadence-site-theme`).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** The active theme. */
  readonly theme = signal<Theme>((document.documentElement.dataset['theme'] as Theme) ?? 'cadence');
  readonly isDark = computed(() => this.theme() === 'cadence-dark');

  /** Switches to the other theme, applies it without transitions and remembers it when storage works. */
  toggle() {
    const next: Theme = this.isDark() ? 'cadence' : 'cadence-dark';
    this.theme.set(next);
    applyThemeInstantly(next);
    try {
      localStorage.setItem('cadence-site-theme', next);
    } catch {
      /* storage unavailable */
    }
  }
}
