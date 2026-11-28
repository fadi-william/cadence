import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

/** Transient notifications rendered by the global `<app-toasts>` stack. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  /**
   * Shows a toast that dismisses itself.
   *
   * @param ms - Display time in milliseconds.
   */
  show(text: string, kind: Toast['kind'] = 'info', ms = 4000) {
    const id = ++this.seq;
    this.toasts.update((t) => [...t, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
  success = (text: string) => this.show(text, 'success');
  /** Error toasts stay longer (6 s) than the default 4 s. */
  error = (text: string) => this.show(text, 'error', 6000);

  dismiss(id: number) {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
