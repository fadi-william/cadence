import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthStore } from './auth.store';

const withToken = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/**
 * Adds the in-memory access token as a Bearer header and recovers from expired tokens.
 *
 * @remarks
 * Requests under `/api/auth/` pass through untouched (they rely on the refresh cookie), except `/auth/me`
 * and `/auth/change-password`, which need the token. On a 401 while a token is held, it calls
 * {@link AuthStore.refresh} (single-flight, so concurrent 401s share one refresh) and retries the request
 * once with the new token; a second 401 is not retried. If the refresh fails, {@link AuthStore.expire}
 * sends the user to the login page and the original error is rethrown. A 401 with no token held (or any
 * other error) is rethrown as is.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore);
  if (
    req.url.includes('/api/auth/') &&
    !req.url.endsWith('/auth/me') &&
    !req.url.endsWith('/auth/change-password')
  ) {
    return next(req);
  }
  return next(withToken(req, auth.token())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !auth.token())
        return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (!ok) {
            auth.expire();
            return throwError(() => err);
          }
          return next(withToken(req, auth.token()));
        }),
      );
    }),
  );
};
