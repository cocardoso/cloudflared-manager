import { defineConfig } from '@playwright/test';

const serverEnv = [
  'NODE_ENV=production',
  'SERVICE_BACKEND=fake',
  'DATA_DIR=.e2e-data',
  'ETC_DIR=.e2e-data/etc',
  'WEB_DIST=apps/web/dist',
  'CF_API_BASE=http://127.0.0.1:18787',
  'PORT=18090',
].join(' ');

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:18090', locale: 'en-US', trace: 'retain-on-failure' },
  webServer: [
    { command: 'FAKE_CF_PORT=18787 pnpm --filter @tm/server exec tsx test/fake-cf-server.ts', port: 18787, reuseExistingServer: false },
    {
      command: `rm -rf .e2e-data && pnpm build && ${serverEnv} node --disable-warning=ExperimentalWarning apps/server/dist/server.mjs`,
      port: 18090,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
