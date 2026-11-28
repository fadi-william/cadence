import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Page title block: optional `eyebrow` above the `heading`, optional `subtitle` below, and projected content
 * (typically action buttons) aligned to the right on wider screens.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between' },
  templateUrl: './page-header.html',
})
export class PageHeader {
  readonly heading = input.required<string>();
  readonly subtitle = input<string>();
  readonly eyebrow = input<string>();
}
