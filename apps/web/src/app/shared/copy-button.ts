import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { Icon } from './icon';

/**
 * Small button that copies `value` to the clipboard and shows "Copied" for 1.5 s. `what` names the value in
 * the accessible label ("Copy link", "Copy secret"). Fails silently where the clipboard API is unavailable.
 */
@Component({
  selector: 'app-copy-button',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './copy-button.html',
})
export class CopyButton {
  readonly value = input.required<string>();
  readonly what = input('value');
  protected readonly copied = signal(false);

  async copy() {
    try {
      await navigator.clipboard.writeText(this.value());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context) */
    }
  }
}
