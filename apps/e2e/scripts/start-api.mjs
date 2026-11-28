// Resets the E2E database, then starts the built API on it.
import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../api');
const url =
  process.env.E2E_DATABASE_URL ?? 'postgresql://cadence:cadence@localhost:5432/cadence_e2e';
if (!new URL(url).pathname.includes('e2e')) {
  throw new Error(`Refusing to reset ${url}: the E2E database name must contain "e2e"`);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
await client.end();

const env = {
  ...process.env,
  DATABASE_URL: url,
  PORT: process.env.E2E_API_PORT ?? '3100',
  WEB_ORIGIN: `http://localhost:${process.env.E2E_WEB_PORT ?? '4300'}`,
  JWT_SECRET: randomBytes(32).toString('hex'),
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SYNC_CRON: 'off',
  SETUP_TOKEN_REQUIRED: 'false',
  THROTTLE_AUTH_LIMIT: '1000',
  REDIS_URL: '',
};
execSync('npx prisma migrate deploy', { cwd: apiDir, env, stdio: 'inherit' });
execSync('npm run build', { cwd: apiDir, env, stdio: 'inherit' });
const api = spawn('node', ['dist/main.js'], { cwd: apiDir, env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => api.kill(sig));
api.on('exit', (code) => process.exit(code ?? 0));
