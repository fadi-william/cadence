import { execSync } from 'node:child_process';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Vitest global setup for the integration project. Starts a throwaway Postgres with Testcontainers, or uses
 * `TEST_DATABASE_URL` when set (CI services, machines without Docker). The `public` schema is dropped and
 * re-migrated with `prisma migrate deploy`, so the database name must contain "test".
 *
 * @remarks
 * The URL is handed to tests through `inject('databaseUrl')`.
 *
 * @returns a teardown that stops the container, if one was started
 * @throws Error when the database path does not contain "test"
 */
export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<unknown>) | undefined;

  if (!url) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('cadence_test').start();
    url = container.getConnectionUri();
    stop = () => container.stop();
  }
  if (!new URL(url).pathname.includes('test')) {
    throw new Error(`Refusing to reset "${url}": the integration-test database name must contain "test"`);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });

  project.provide('databaseUrl', url);
  return async () => {
    await stop?.();
  };
}
