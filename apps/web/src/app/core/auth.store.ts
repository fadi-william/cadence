import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { AuthResponseDto, AuthUserDto, UserRole } from '@cadence/shared';
import { ApiService } from './api.service';

/**
 * Non-secret hint that a refresh cookie may exist, so anonymous visits skip a pointless `/auth/refresh`.
 * Reads as `true` when storage is unavailable, so a refresh is still attempted.
 */
const SESSION_HINT = 'cadence-session';
const hint = {
  get: () => {
    try {
      return localStorage.getItem(SESSION_HINT) === '1';
    } catch {
      return true;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(SESSION_HINT, '1');
      else localStorage.removeItem(SESSION_HINT);
    } catch {
      /* storage unavailable */
    }
  },
};

/**
 * Session state. The access token lives in memory only; the refresh token is an httpOnly
 * cookie scoped to `/api/auth`, so a page reload restores the session via `POST /auth/refresh`.
 *
 * @remarks
 * After each successful sign-in or refresh the store schedules the next refresh a minute before the
 * access token expires (at least 10 seconds out), so an active tab keeps its session without hitting 401s.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  /** Current access token, or `null` when signed out. Never persisted. */
  readonly token = signal<string | null>(null);
  /** The signed-in user, or `null` when signed out. */
  readonly user = signal<AuthUserDto | null>(null);
  readonly isAuthenticated = computed(() => !!this.token());
  /** The signed-in user's role, or `null` when signed out. */
  readonly role = computed(() => this.user()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'ADMIN');

  private refreshing: Promise<boolean> | null = null;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  /** True when signed in with any of the given roles. */
  hasRole(...roles: UserRole[]) {
    const r = this.role();
    return !!r && roles.includes(r);
  }

  /**
   * Stores a fresh auth response: sets token and user, records the session hint and (re)schedules the
   * proactive refresh.
   */
  accept(res: AuthResponseDto) {
    this.token.set(res.accessToken);
    this.user.set(res.user);
    hint.set(true);
    // Refresh a minute before the access token expires.
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => void this.refresh(),
      Math.max(10, res.expiresIn - 60) * 1000,
    );
  }

  /**
   * Signs in with email and password.
   *
   * @throws The `HttpErrorResponse` from the API when the credentials are rejected.
   */
  async login(email: string, password: string) {
    this.accept(await this.api.login({ email, password }));
  }

  /**
   * Single-flight refresh shared by the interceptor, guards and the timer.
   *
   * @returns `true` when a new token was obtained; `false` when the refresh cookie was missing or
   * rejected, in which case the session is cleared (without navigating).
   */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.api
      .refresh()
      .then((res) => {
        this.accept(res);
        return true;
      })
      .catch(() => {
        this.clear();
        return false;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /**
   * True when a session exists (restoring it from the refresh cookie if needed). Skips the network call
   * when the session hint says no cookie was ever set.
   */
  async ensureUser(): Promise<boolean> {
    if (this.token() && this.user()) return true;
    if (!hint.get()) return false;
    return this.refresh();
  }

  /** Drops the session locally: cancels the refresh timer, clears token and user, removes the hint. */
  clear() {
    clearTimeout(this.refreshTimer);
    this.token.set(null);
    this.user.set(null);
    hint.set(false);
  }

  /** Revokes the refresh token server-side (errors ignored), clears the session and goes to `/login`. */
  async logout() {
    await this.api.logout().catch(() => undefined);
    this.clear();
    void this.router.navigateByUrl('/login');
  }

  /**
   * Called when a refresh fails mid-session: clears the session and redirects to `/login` with `next`
   * (the current URL) and `expired=1` query params.
   */
  expire() {
    this.clear();
    void this.router.navigate(['/login'], { queryParams: { next: this.router.url, expired: 1 } });
  }
}
