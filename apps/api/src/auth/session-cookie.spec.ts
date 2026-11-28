import type { Request, Response } from 'express';
import { REFRESH_COOKIE, clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './session-cookie';

describe('session cookie', () => {
  const res = () => ({ cookie: vi.fn(), clearCookie: vi.fn() });
  const asRes = (r: ReturnType<typeof res>) => r as unknown as Response;

  afterEach(() => vi.unstubAllEnvs());

  it('sets an http-only, strict, path-scoped cookie with a max age', () => {
    vi.stubEnv('COOKIE_SECURE', '');
    vi.stubEnv('NODE_ENV', 'development');
    const r = res();
    setRefreshCookie(asRes(r), 'tok', 1000);
    expect(r.cookie).toHaveBeenCalledWith(REFRESH_COOKIE, 'tok', {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/api/auth',
      maxAge: 1000,
    });
  });

  it('is secure in production unless COOKIE_SECURE overrides it', () => {
    vi.stubEnv('COOKIE_SECURE', '');
    vi.stubEnv('NODE_ENV', 'production');
    const r = res();
    setRefreshCookie(asRes(r), 'tok', 1);
    expect(r.cookie.mock.calls[0][2].secure).toBe(true);

    vi.stubEnv('COOKIE_SECURE', 'false');
    setRefreshCookie(asRes(r), 'tok', 1);
    expect(r.cookie.mock.calls[1][2].secure).toBe(false);

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('COOKIE_SECURE', 'true');
    setRefreshCookie(asRes(r), 'tok', 1);
    expect(r.cookie.mock.calls[2][2].secure).toBe(true);
  });

  it('clears with matching options and no max age', () => {
    const r = res();
    clearRefreshCookie(asRes(r));
    const [name, opts] = r.clearCookie.mock.calls[0];
    expect(name).toBe(REFRESH_COOKIE);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/api/auth' });
    expect(opts).not.toHaveProperty('maxAge');
  });

  it('reads the cookie when cookie-parser ran, undefined otherwise', () => {
    expect(readRefreshCookie({ cookies: { [REFRESH_COOKIE]: 'abc' } } as unknown as Request)).toBe('abc');
    expect(readRefreshCookie({ cookies: {} } as unknown as Request)).toBeUndefined();
    expect(readRefreshCookie({} as Request)).toBeUndefined();
  });
});
