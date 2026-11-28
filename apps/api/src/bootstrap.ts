import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestContextMiddleware } from './common/context/request-context';

/**
 * Shared HTTP setup for `main.ts` and the integration tests: `/api` prefix, Helmet, cookie parsing, the
 * request-context middleware, credentialed CORS for `WEB_ORIGIN` (comma-separated, default
 * `http://localhost:4200`), strict DTO validation (unknown properties are rejected) and shutdown hooks.
 *
 * @remarks
 * `trust proxy` comes from `TRUST_PROXY` (default `loopback`) so `req.ip` is the real client IP behind a
 * load balancer; the audit log and rate limiting rely on it.
 *
 * @returns the same app, for chaining
 */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? 'http://localhost:4200', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return app;
}
