import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma/prisma.service';

/** A booted test application plus helpers; created by {@link createHarness}. */
export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  /** A fresh supertest agent bound to the app's HTTP server. Paths include the `/api` prefix. */
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Boots the full AppModule (real DB, in-process sync, no Redis). Other env comes from vitest.config.ts. */
export async function createHarness(): Promise<Harness> {
  process.env.DATABASE_URL = inject('databaseUrl');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ rawBody: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, http: () => request(app.getHttpServer()), close: () => app.close() };
}

/** Empties every table (keeps the schema). */
export async function resetDb(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

/**
 * Extracts the refresh cookie (`cadence_rt=...`, without attributes) from a response so it can be sent back
 * in a `Cookie` header.
 *
 * @returns the `name=value` pair, or undefined when the response set no refresh cookie
 */
export const refreshCookie = (res: { headers: Record<string, unknown> }) => {
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return cookies.find((c) => c.startsWith('cadence_rt='))?.split(';')[0];
};
