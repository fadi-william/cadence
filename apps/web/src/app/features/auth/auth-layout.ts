import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BrandArcs } from '../../shared/brand-arcs';
import { Icon } from '../../shared/icon';
import { Logo } from '../../shared/logo';

/**
 * Split auth layout: wine brand panel (desktop) + form column. The page's form is
 * projected into the column; `tagline` overrides the headline on the brand panel.
 */
@Component({
  selector: 'app-auth-layout',
  imports: [BrandArcs, Icon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-layout.html',
})
export class AuthLayout {
  readonly tagline = input('Understand how your teams deliver.');
  protected readonly bullets = [
    { icon: 'org', text: 'Tribes, teams and people in one place' },
    { icon: 'layers', text: 'Azure DevOps and Jira, merged per person' },
    { icon: 'rocket', text: 'DORA delivery metrics from your pipelines' },
  ];
}
