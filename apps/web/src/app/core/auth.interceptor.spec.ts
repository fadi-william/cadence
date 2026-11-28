import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthStore } from './auth.store';

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let auth: {
    token: ReturnType<typeof signal<string | null>>;
    refresh: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    auth = { token: signal<string | null>('t1'), refresh: vi.fn(), expire: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  const unauthorized = { status: 401, statusText: 'Unauthorized' };
  const flushMicrotasks = () => new Promise((r) => setTimeout(r));

  it('adds the bearer token', async () => {
    const p = firstValueFrom(http.get('/api/members'));
    const req = ctrl.expectOne('/api/members');
    expect(req.request.headers.get('Authorization')).toBe('Bearer t1');
    req.flush([]);
    await p;
  });

  it('sends no Authorization header without a token', async () => {
    auth.token.set(null);
    const p = firstValueFrom(http.get('/api/members'));
    const req = ctrl.expectOne('/api/members');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
    await p;
  });

  it.each(['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'])(
    'leaves %s untouched',
    async (url) => {
      const p = firstValueFrom(http.post(url, {}));
      const req = ctrl.expectOne(url);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
      await p;
    },
  );

  it.each(['/api/auth/me', '/api/auth/change-password'])('authorizes %s', async (url) => {
    const p = firstValueFrom(http.post(url, {}));
    const req = ctrl.expectOne(url);
    expect(req.request.headers.get('Authorization')).toBe('Bearer t1');
    req.flush({});
    await p;
  });

  it('does not retry auth endpoints on 401', async () => {
    const p = firstValueFrom(http.post('/api/auth/login', {}));
    ctrl.expectOne('/api/auth/login').flush({}, unauthorized);
    await expect(p).rejects.toMatchObject({ status: 401 });
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('refreshes on 401 and retries with the new token', async () => {
    auth.refresh.mockImplementation(async () => {
      auth.token.set('t2');
      return true;
    });
    const p = firstValueFrom(http.get('/api/members'));
    ctrl.expectOne('/api/members').flush({}, unauthorized);
    await flushMicrotasks();
    const retry = ctrl.expectOne('/api/members');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer t2');
    retry.flush(['ok']);
    await expect(p).resolves.toEqual(['ok']);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(auth.expire).not.toHaveBeenCalled();
  });

  it('expires the session when the refresh fails', async () => {
    auth.refresh.mockResolvedValue(false);
    const p = firstValueFrom(http.get('/api/members'));
    ctrl.expectOne('/api/members').flush({}, unauthorized);
    await expect(p).rejects.toMatchObject({ status: 401 });
    expect(auth.expire).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when there was no token (anonymous 401)', async () => {
    auth.token.set(null);
    const p = firstValueFrom(http.get('/api/members'));
    ctrl.expectOne('/api/members').flush({}, unauthorized);
    await expect(p).rejects.toMatchObject({ status: 401 });
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('passes other errors through', async () => {
    const p = firstValueFrom(http.get('/api/members'));
    ctrl.expectOne('/api/members').flush({}, { status: 403, statusText: 'Forbidden' });
    await expect(p).rejects.toMatchObject({ status: 403 });
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('only retries once', async () => {
    auth.refresh.mockResolvedValue(true);
    const p = firstValueFrom(http.get('/api/members'));
    ctrl.expectOne('/api/members').flush({}, unauthorized);
    await flushMicrotasks();
    ctrl.expectOne('/api/members').flush({}, unauthorized);
    await expect(p).rejects.toMatchObject({ status: 401 });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });
});
