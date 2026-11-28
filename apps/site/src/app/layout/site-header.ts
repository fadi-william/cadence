import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { REPO_URL } from '../site';
import { ThemeService } from '../theme.service';
import { Icon } from '../ui/icon';
import { Logo } from '../ui/logo';

/**
 * Sticky top bar: logo, section links, dark-mode toggle, GitHub button and, on small screens, a
 * dropdown menu with the same links.
 */
@Component({
  selector: 'site-header',
  imports: [RouterLink, RouterLinkActive, Icon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'sticky top-0 z-40 block border-b border-base-content/10 bg-base-200/85 pt-[env(safe-area-inset-top)] backdrop-blur-md',
  },
  templateUrl: './site-header.html',
})
export class SiteHeader {
  protected readonly theme = inject(ThemeService);
  protected readonly repo = REPO_URL;
  /** Toggled by the mobile menu button. */
  protected readonly open = signal(false);
  /**
   * Navigation entries. Entries with a `fragment` jump to a section of the landing page; the others
   * are routes and get active-link styling.
   */
  protected readonly links = [
    { label: 'Features', path: '/', fragment: 'features' },
    { label: 'How it works', path: '/', fragment: 'how-it-works' },
    { label: 'Docs', path: '/docs', fragment: undefined },
  ];
}
