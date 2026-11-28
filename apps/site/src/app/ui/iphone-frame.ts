import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A modern iPhone (Dynamic Island, flat titanium band) drawn in CSS.
 * Project a full-screen capture (an `<img>` or `<video>` at 393 x 852, recorded with the iPhone safe
 * areas applied) into it. The frame draws the status bar and home indicator over the app, in the
 * space the app's own safe-area padding leaves free, just like iOS does.
 */
@Component({
  selector: 'app-iphone-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styleUrl: './iphone-frame.css',
  templateUrl: './iphone-frame.html',
})
export class IphoneFrame {
  /** Overall width in CSS pixels. */
  readonly width = input(280);
}
