import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { SiteFooter } from './layout/site-footer';
import { SiteHeader } from './layout/site-header';

/**
 * Root shell: the sticky site header, the routed page inside `<main>`, and the footer. The footer waits
 * for the first page to render, so it doesn't flash at the top of the screen while that page loads.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeader, SiteFooter],
  templateUrl: './app.html',
})
export class App {
  protected readonly pageShown = toSignal(
    inject(Router).events.pipe(
      filter((e) => e instanceof NavigationEnd),
      take(1),
      map(() => true),
    ),
    { initialValue: false },
  );
}
