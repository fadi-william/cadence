import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Two Vitest projects: `unit` (`src/**` specs, no database) and `integration` (`test/**` int-specs against a
 * real Postgres prepared by `test/global-setup.ts`, run one file at a time).
 *
 * @remarks
 * SWC is used instead of esbuild because it keeps decorator metadata, which Nest's DI needs.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int-spec.ts'],
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
          fileParallelism: false,
          // Read at module load (throttle limits), so they are set before any test imports.
          env: {
            JWT_SECRET: 'integration-test-secret-'.padEnd(48, 'x'),
            APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
            SYNC_CRON: 'off',
            THROTTLE_AUTH_LIMIT: '1000',
            THROTTLE_LIMIT: '10000',
            WEBHOOK_DEBOUNCE_MS: '100',
            SETUP_TOKEN_REQUIRED: 'false',
            REDIS_URL: '',
          },
        },
      },
    ],
  },
});
