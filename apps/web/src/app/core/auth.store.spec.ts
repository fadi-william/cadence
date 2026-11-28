import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { AuthResponseDto } from '@cadence/shared';
import { ApiService } from './api.service';
import { AuthStore } from './auth.store';

const HINT = 'cadence-session';
const res = (over: Partial<AuthResponseDto> = {}): AuthResponseDto =>
  ({
    accessToken: 'tok',
    expiresIn: 900,
    user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'ADMIN' },
    ...over,
  }) as AuthResponseDto;

describe('AuthStore', () => {
  let store: AuthStore;
  let api: {
    login: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  let router: {
    url: string;
    navigate: ReturnType<typeof vi.fn>;
    navigateByUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    api = { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
    router = { url: '/members?x=1', navigate: vi.fn(), navigateByUrl: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
      ],
    });
    store = TestBed.inject(AuthStore);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts anonymous', () => {
    expect(store.isAuthenticated()).toBe(false);
    expect(store.role()).toBeNull();
    expect(store.isAdmin()).toBe(false);
    expect(store.hasRole('ADMIN')).toBe(false);
  });

  it('accept stores the session and sets the session hint', () => {
    store.accept(res());
    expect(store.token()).toBe('tok');
    expect(store.user()?.email).toBe('a@b.c');
    expect(store.isAuthenticated()).toBe(true);
    expect(store.isAdmin()).toBe(true);
    expect(localStorage.getItem(HINT)).toBe('1');
  });

  it('hasRole matches any of the given roles', () => {
    store.accept(
      res({ user: { id: 'u', email: 'e', name: 'n', role: 'ENGINEERING_MANAGER' } as never }),
    );
    expect(store.hasRole('ADMIN')).toBe(false);
    expect(store.hasRole('ADMIN', 'ENGINEERING_MANAGER')).toBe(true);
    expect(store.isAdmin()).toBe(false);
  });

  it('schedules a refresh one minute before expiry', () => {
    api.refresh.mockResolvedValue(res({ accessToken: 'tok2' }));
    store.accept(res({ expiresIn: 900 }));
    vi.advanceTimersByTime(839_999);
    expect(api.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('never schedules the refresh sooner than 10 s', () => {
    api.refresh.mockResolvedValue(res());
    store.accept(res({ expiresIn: 30 }));
    vi.advanceTimersByTime(9_999);
    expect(api.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('re-accepting replaces the pending refresh timer', () => {
    api.refresh.mockResolvedValue(res());
    store.accept(res({ expiresIn: 100 })); // 40 s
    store.accept(res({ expiresIn: 900 })); // 840 s
    vi.advanceTimersByTime(60_000);
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('login calls the API and accepts the response', async () => {
    api.login.mockResolvedValue(res());
    await store.login('a@b.c', 'pw');
    expect(api.login).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
    expect(store.token()).toBe('tok');
  });

  it('login propagates API errors and stays anonymous', async () => {
    api.login.mockRejectedValue(new Error('bad'));
    await expect(store.login('a', 'b')).rejects.toThrow('bad');
    expect(store.isAuthenticated()).toBe(false);
  });

  it('refresh is single-flight', async () => {
    let resolve!: (v: AuthResponseDto) => void;
    api.refresh.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = store.refresh();
    const b = store.refresh();
    expect(a).toBe(b);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    resolve(res({ accessToken: 'new' }));
    await expect(a).resolves.toBe(true);
    expect(store.token()).toBe('new');

    // a later call starts a new request
    api.refresh.mockResolvedValue(res());
    await store.refresh();
    expect(api.refresh).toHaveBeenCalledTimes(2);
  });

  it('failed refresh clears the session and resolves false', async () => {
    store.accept(res());
    api.refresh.mockRejectedValue(new Error('401'));
    await expect(store.refresh()).resolves.toBe(false);
    expect(store.token()).toBeNull();
    expect(store.user()).toBeNull();
    expect(localStorage.getItem(HINT)).toBeNull();
  });

  describe('ensureUser', () => {
    it('is true without a request when a session exists', async () => {
      store.accept(res());
      await expect(store.ensureUser()).resolves.toBe(true);
      expect(api.refresh).not.toHaveBeenCalled();
    });

    it('skips the refresh for anonymous visitors without a session hint', async () => {
      await expect(store.ensureUser()).resolves.toBe(false);
      expect(api.refresh).not.toHaveBeenCalled();
    });

    it('restores the session from the refresh cookie when hinted', async () => {
      localStorage.setItem(HINT, '1');
      api.refresh.mockResolvedValue(res());
      await expect(store.ensureUser()).resolves.toBe(true);
      expect(store.isAuthenticated()).toBe(true);
    });

    it('tries a refresh when storage is unavailable', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      api.refresh.mockRejectedValue(new Error('no cookie'));
      await expect(store.ensureUser()).resolves.toBe(false);
      expect(api.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('clear cancels the scheduled refresh', () => {
    store.accept(res({ expiresIn: 100 }));
    store.clear();
    vi.advanceTimersByTime(3_600_000);
    expect(api.refresh).not.toHaveBeenCalled();
    expect(store.isAuthenticated()).toBe(false);
  });

  it('logout clears the session and goes to /login even if the API fails', async () => {
    store.accept(res());
    api.logout.mockRejectedValue(new Error('offline'));
    await store.logout();
    expect(api.logout).toHaveBeenCalled();
    expect(store.isAuthenticated()).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('expire clears the session and redirects back with next + expired', () => {
    store.accept(res());
    store.expire();
    expect(store.isAuthenticated()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { next: '/members?x=1', expired: 1 },
    });
  });
});
