// Kept in sync with apps/web/src/app/shared.
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { IntegrationProvider } from '@cadence/shared';

/** Simplified Azure DevOps / Jira marks in their brand colours. */
@Component({
  selector: 'app-provider-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  templateUrl: './provider-icon.html',
})
export class ProviderIcon {
  readonly provider = input.required<IntegrationProvider>();
  /** Width and height in CSS pixels. */
  readonly size = input(20);
}
