import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration: schema and migrations location, and the demo seed run by `prisma db seed`.
 * Loads `.env` so the CLI sees the same `DATABASE_URL` as the API.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed-demo.ts' },
  // `prisma generate` doesn't connect, so builds (CI, Docker) work without DATABASE_URL;
  // migrate/studio need the real value.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://build:build@localhost:5432/build' },
});
