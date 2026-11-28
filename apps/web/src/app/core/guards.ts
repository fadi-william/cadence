import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { UserRole } from '@cadence/shared';
import { ApiService } from './api.service';
import { AuthStore } from './auth.store';

/** Cached once setup is known to be complete, so later navigations skip the status call. */
let setupDone = false;

/**
 * Until the first admin has a password, every guarded route redirects to `/setup`. If the status call
 * fails (API unreachable) navigation is allowed so the page can surface the error.
 */
export const setupGuard: CanActivateFn = async () => {
  if (setupDone) return true;
  const router = inject(Router);
  try {
    const status = await inject(ApiService).setupStatus();
    if (status.needsSetup) return router.parseUrl('/setup');
    setupDone = true;
    return true;
  } catch {
    return true; // API unreachable — let the page surface the error
  }
};

/**
 * `/setup` is only reachable while setup is pending; afterwards it redirects to `/login`. If the status
 * call fails the page is shown.
 */
export const setupPageGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const status = await inject(ApiService)
    .setupStatus()
    .catch(() => null);
  if (status && !status.needsSetup) {
    setupDone = true;
    return router.parseUrl('/login');
  }
  return true;
};

/** Lets the setup page record completion so {@link setupGuard} stops checking. */
export const markSetupDone = () => (setupDone = true);

/**
 * Requires a session (restoring it from the refresh cookie if needed); otherwise redirects to `/login`
 * with the attempted URL in the `next` query param.
 */
export const authGuard: CanActivateFn = async (_, state) => {
  const router = inject(Router);
  const ok = await inject(AuthStore).ensureUser();
  return ok ? true : router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** For the login page: a signed-in user (or one whose session can be restored) is sent to `/`. */
export const guestGuard: CanActivateFn = async () => {
  // inject() must run before the first await (injection context ends there).
  const router = inject(Router);
  const ok = await inject(AuthStore).ensureUser();
  return ok ? router.parseUrl('/') : true;
};

/**
 * Allows the route only for the given roles; anyone else is redirected to `/`. Relies on the user
 * already being loaded, so it must run after {@link authGuard} (e.g. on a child of the shell route).
 */
export const roleGuard =
  (...roles: UserRole[]): CanActivateFn =>
  () => {
    const auth = inject(AuthStore);
    return auth.hasRole(...roles) ? true : inject(Router).parseUrl('/');
  };
