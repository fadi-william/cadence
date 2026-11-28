import type { CookieOptions, Request, Response } from 'express';

/** Name of the refresh-token cookie. */
export const REFRESH_COOKIE = 'cadence_rt';

/**
 * httpOnly, SameSite=Strict cookie scoped to `/api/auth`, so it is only sent to the auth endpoints.
 * `Secure` follows `COOKIE_SECURE` when set, otherwise it is on in production.
 */
const options = (maxAgeMs?: number): CookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  path: '/api/auth',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

/** Sets the refresh cookie with the given max-age in milliseconds. */
export const setRefreshCookie = (res: Response, token: string, maxAgeMs: number) =>
  res.cookie(REFRESH_COOKIE, token, options(maxAgeMs));

export const clearRefreshCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, options());

/** The refresh cookie value, or undefined when absent. Needs `cookie-parser`. */
export const readRefreshCookie = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
