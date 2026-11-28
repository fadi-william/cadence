import { Injectable, signal } from '@angular/core';

const KEY = 'cadence-nav-collapsed';

/** Sidenav state shared by the shell. Only the collapsed state persists (in `localStorage`). */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** Desktop sidenav shows icons only. */
  readonly collapsed = signal(read());
  /** Mobile drawer is open. */
  readonly mobileOpen = signal(false);

  toggleCollapsed() {
    this.collapsed.update((v) => !v);
    try {
      localStorage.setItem(KEY, this.collapsed() ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }
}

function read() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
