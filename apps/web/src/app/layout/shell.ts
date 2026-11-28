import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ROLE_LABELS } from '@cadence/shared';
import { AuthStore } from '../core/auth.store';
import { LayoutService } from '../core/layout.service';
import { ThemeService } from '../core/theme.service';
import { Avatar } from '../shared/avatar';
import { Icon } from '../shared/icon';
import { Logo } from '../shared/logo';

interface NavItem {
  /** Absolute router path; also used as a prefix to detect the current page. */
  path: string;
  label: string;
  icon: string;
}
interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Authenticated app chrome around every signed-in page: a daisyUI drawer sidenav (collapsible on desktop,
 * slide-over on mobile), a sticky top bar with breadcrumb, theme toggle and account menu, and a Material 3
 * style bottom navigation bar on mobile. The Administration nav section is only shown to admins.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Avatar, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()' },
  templateUrl: './shell.html',
})
export class Shell {
  protected readonly auth = inject(AuthStore);
  protected readonly theme = inject(ThemeService);
  protected readonly layout = inject(LayoutService);
  private readonly router = inject(Router);
  protected readonly user = this.auth.user;
  protected readonly roleLabel = computed(() =>
    this.auth.role() ? ROLE_LABELS[this.auth.role()!] : '',
  );

  /** Shortcuts in the mobile bottom bar; the rest of the nav is reached through its "More" drawer button. */
  protected readonly dockItems: NavItem[] = [
    { path: '/dashboard', label: 'Home', icon: 'dashboard' },
    { path: '/delivery', label: 'Delivery', icon: 'rocket' },
    { path: '/members', label: 'People', icon: 'users' },
    { path: '/organization', label: 'Org', icon: 'org' },
  ];

  protected readonly sections = computed<NavSection[]>(() => [
    {
      title: 'Insights',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
        { path: '/delivery', label: 'Delivery (DORA)', icon: 'rocket' },
      ],
    },
    {
      title: 'Organization',
      items: [
        { path: '/members', label: 'People', icon: 'users' },
        { path: '/organization', label: 'Teams & tribes', icon: 'org' },
      ],
    },
    ...(this.auth.isAdmin()
      ? [
          {
            title: 'Administration',
            items: [
              { path: '/integrations', label: 'Integrations', icon: 'plug' },
              { path: '/audit', label: 'Audit log', icon: 'history' },
            ],
          },
        ]
      : []),
  ]);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Section + label of the current page, for the top-bar breadcrumb. */
  protected readonly current = computed(() => {
    const url = this.url();
    for (const s of this.sections()) {
      const item = s.items.find((i) => url.startsWith(i.path));
      if (item) return { section: s.title, label: item.label };
    }
    if (url.startsWith('/account')) return { section: 'You', label: 'Account' };
    return null;
  });

  /** Closes the mobile drawer, e.g. after a nav link is clicked. */
  close() {
    this.layout.mobileOpen.set(false);
  }

  /**
   * M3 bars may hide while scrolling down and return on scroll up. Hidden only once scrolled past 120 px;
   * movements under 8 px are ignored to avoid jitter.
   */
  protected readonly barHidden = signal(false);
  private lastY = 0;
  onScroll() {
    const y = window.scrollY;
    if (Math.abs(y - this.lastY) < 8) return;
    this.barHidden.set(y > this.lastY && y > 120);
    this.lastY = y;
  }
}
