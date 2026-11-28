import { Routes } from '@angular/router';

/**
 * Lazy-loaded pages: the landing page at `/` and one guide per `/docs/:slug` (`/docs` opens
 * getting-started). Any unknown path redirects to the landing page.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/home.page').then((m) => m.HomePage),
    title: 'Cadence: see how your engineering teams deliver',
  },
  { path: 'docs', pathMatch: 'full', redirectTo: 'docs/getting-started' },
  {
    path: 'docs/:slug',
    loadComponent: () => import('./pages/docs.page').then((m) => m.DocsPage),
  },
  { path: '**', redirectTo: '' },
];
