import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Per-request ambient data (client IP, authenticated user) for audit logging. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
  /** Set by `AuthGuard` once the access token is verified; undefined on public routes. */
  user?: AuthenticatedUser;
}

/** Holds the {@link RequestContext} for the duration of each HTTP request. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

/** Express middleware that opens a context with the client IP and user agent for the rest of the request. */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  requestContext.run({ ip: req.ip, userAgent: req.headers['user-agent'] }, next);
}

/** The current request's context, or an empty object outside a request (jobs, startup). */
export const currentContext = (): RequestContext => requestContext.getStore() ?? {};
