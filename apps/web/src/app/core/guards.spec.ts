import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

type Guards = typeof import('./guards');

describe('guards', () => {
  let guards: Guards;
  let api: { setupStatus: ReturnType<typeof vi.fn> };
  let auth: { ensureUser: ReturnType<typeof vi.fn>; hasRole: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Fresh module per test: setupGuard caches "setup done" in module state.
    vi.resetModules();
    guards = await import('./guards');
    // Re-import the tokens too, so they match the classes the fresh guards module injects.
    const { ApiService } = await import('./api.service');
    const { AuthStore } = await import('./auth.store');
    api = { setupStatus: vi.fn() };
    auth = { ensureUser: vi.fn(), hasRole: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthStore, useValue: auth },
      ],
    });
  });

  const run = (guard: CanActivateFn, url = '/') =>
    runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree> | boolean | UrlTree;
  const ser = (v: unknown) => (v instanceof UrlTree ? TestBed.inject(Router).serializeUrl(v) : v);

  describe('setupGuard', () => {
    it('redirects to /setup while setup is pending', async () => {
      api.setupStatus.mockResolvedValue({ needsSetup: true });
      expect(ser(await run(guards.setupGuard))).toBe('/setup');
      // not cached: asks again
      await run(guards.setupGuard);
      expect(api.setupStatus).toHaveBeenCalledTimes(2);
    });

    it('allows and caches once setup is done', async () => {
      api.setupStatus.mockResolvedValue({ needsSetup: false });
      expect(await run(guards.setupGuard)).toBe(true);
      expect(await run(guards.setupGuard)).toBe(true);
      expect(api.setupStatus).toHaveBeenCalledTimes(1);
    });

    it('lets the page load when the API is unreachable', async () => {
      api.setupStatus.mockRejectedValue(new Error('down'));
      expect(await run(guards.setupGuard)).toBe(true);
    });

    it('markSetupDone skips the status call', async () => {
      guards.markSetupDone();
      expect(await run(guards.setupGuard)).toBe(true);
      expect(api.setupStatus).not.toHaveBeenCalled();
    });
  });

  describe('setupPageGuard', () => {
    it('allows /setup while setup is pending', async () => {
      api.setupStatus.mockResolvedValue({ needsSetup: true });
      expect(await run(guards.setupPageGuard)).toBe(true);
    });

    it('sends finished installs to /login and marks setup done', async () => {
      api.setupStatus.mockResolvedValue({ needsSetup: false });
      expect(ser(await run(guards.setupPageGuard))).toBe('/login');
      expect(await run(guards.setupGuard)).toBe(true);
      expect(api.setupStatus).toHaveBeenCalledTimes(1);
    });

    it('allows the page when the API is unreachable', async () => {
      api.setupStatus.mockRejectedValue(new Error('down'));
      expect(await run(guards.setupPageGuard)).toBe(true);
    });
  });

  describe('authGuard', () => {
    it('allows signed-in users', async () => {
      auth.ensureUser.mockResolvedValue(true);
      expect(await run(guards.authGuard, '/members')).toBe(true);
    });

    it('redirects to /login with the requested url', async () => {
      auth.ensureUser.mockResolvedValue(false);
      expect(ser(await run(guards.authGuard, '/members/42'))).toBe('/login?next=%2Fmembers%2F42');
    });
  });

  describe('guestGuard', () => {
    it('sends signed-in users home', async () => {
      auth.ensureUser.mockResolvedValue(true);
      expect(ser(await run(guards.guestGuard))).toBe('/');
    });

    it('allows anonymous visitors', async () => {
      auth.ensureUser.mockResolvedValue(false);
      expect(await run(guards.guestGuard)).toBe(true);
    });
  });

  describe('roleGuard', () => {
    it('allows users with one of the roles', () => {
      auth.hasRole.mockReturnValue(true);
      expect(run(guards.roleGuard('ADMIN', 'ENGINEERING_MANAGER'))).toBe(true);
      expect(auth.hasRole).toHaveBeenCalledWith('ADMIN', 'ENGINEERING_MANAGER');
    });

    it('redirects others home', () => {
      auth.hasRole.mockReturnValue(false);
      expect(ser(run(guards.roleGuard('ADMIN')))).toBe('/');
    });
  });
});
