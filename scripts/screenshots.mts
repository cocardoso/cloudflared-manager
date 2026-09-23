// Regenerates the README screenshots from made-up data: a fake Cloudflare API, the fake service
// backend and only documentation domains (example.com/.net/.org).
// Usage: pnpm build && pnpm --filter @tm/server exec tsx ../../scripts/screenshots.mts
import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeCloudflare } from '../apps/server/test/fake-cloudflare';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs/screenshots');
const PORT = 18095;
const APP = `http://127.0.0.1:${PORT}`;

const cf = await startFakeCloudflare();
const home = { id: 'a'.repeat(32), name: 'Home Lab' };
const acme = { id: 'b'.repeat(32), name: 'Acme Corp' };
cf.state.accounts = [home, acme];
cf.state.zones = [
  { id: `${'z'.repeat(31)}1`, name: 'example.com', status: 'active', account: home },
  { id: `${'z'.repeat(31)}2`, name: 'example.net', status: 'active', account: home },
  { id: `${'z'.repeat(31)}3`, name: 'example.org', status: 'active', account: acme },
];
for (const z of cf.state.zones) cf.state.dns.set(z.id, []);

const data = mkdtempSync(join(tmpdir(), 'tm-shots-'));
const server = spawn('node', ['--disable-warning=ExperimentalWarning', join(ROOT, 'apps/server/dist/server.mjs')], {
  env: {
    ...process.env, NODE_ENV: 'production', SERVICE_BACKEND: 'fake', DATA_DIR: data, ETC_DIR: join(data, 'etc'),
    WEB_DIST: join(ROOT, 'apps/web/dist'), CF_API_BASE: cf.baseUrl, PORT: String(PORT),
  },
  stdio: 'inherit',
});

try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${APP}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(APP + path, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };

  await call('POST', '/api/setup/admin', { username: 'admin', password: 'correct-horse-battery-staple' });
  await call('POST', '/api/cloudflare/token', { token: cf.token });

  const tunnel = async (name: string, account: string, routes: [string, string][]) => {
    const t = (await call('POST', '/api/tunnels', { name, accountId: account })) as { id: string };
    await call('PUT', `/api/tunnels/${t.id}/routes`, {
      version: 0, routes: routes.map(([hostname, service]) => ({ hostname, service })), overwriteDns: [], keepDns: [],
    });
    return t.id;
  };
  const homelab = await tunnel('homelab', home.id, [
    ['ha.example.com', 'http://192.168.1.10:8123'],
    ['git.example.com', 'http://192.168.1.20:3000'],
    ['files.example.net', 'http://192.168.1.30:8080'],
  ]);
  const media = await tunnel('media', home.id, [['jellyfin.example.net', 'http://192.168.1.40:8096']]);
  const office = await tunnel('office', acme.id, [['wiki.example.org', 'http://10.0.0.15:3000']]);
  await fetch(`${cf.baseUrl}/accounts/${acme.id}/cfd_tunnel`, {
    method: 'POST', headers: { authorization: `Bearer ${cf.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-office', config_src: 'cloudflare' }),
  });

  // Edge state as Cloudflare would report it for running tunnels.
  const connect = (id: string, colos: string[], status: 'healthy' | 'degraded' = 'healthy') => {
    const e = cf.state.tunnels.get(id)!;
    e.tunnel.status = status;
    e.tunnel.connections = colos.map((c, i) => ({
      colo_name: c, opened_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
      origin_ip: '203.0.113.7', client_version: '2026.9.1', is_pending_reconnect: false,
    }));
  };
  connect(homelab, ['gru01', 'gru02', 'eze01', 'scl01']);
  connect(media, ['gru01', 'eze01'], 'degraded');
  connect(office, ['fra06', 'ams01', 'fra08', 'cdg01']);
  for (const e of cf.state.tunnels.values()) if (e.tunnel.name === 'branch-office') connect(e.tunnel.id, ['lhr01', 'man01']);

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'en-US' });
  await context.addCookies([{ name: cookie.split('=')[0]!, value: cookie.split('=')[1]!, url: APP }]);
  const page = await context.newPage();
  const shot = async (p: Page, name: string) => {
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(500);
    await p.screenshot({ path: join(OUT, `${name}.png`) });
  };

  await page.goto(`${APP}/`);
  await page.getByRole('link', { name: 'homelab' }).waitFor();
  await shot(page, 'dashboard');

  await page.goto(`${APP}/tunnels/${homelab}?tab=routes`);
  await page.getByText('ha.example.com').waitFor();
  await shot(page, 'tunnel-routes');

  await page.getByRole('button', { name: 'Add public hostname' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Subdomain').fill('grafana');
  await dialog.getByLabel('URL').fill('192.168.1.50:3000');
  await shot(page, 'add-hostname');
  await page.keyboard.press('Escape');

  await page.goto(`${APP}/tunnels/${homelab}?tab=status`);
  await page.getByText('Details').waitFor();
  await shot(page, 'tunnel-status');

  await page.goto(`${APP}/settings`);
  await page.getByText('Acme Corp').waitFor();
  await shot(page, 'settings');

  await page.evaluate(() => localStorage.setItem('tm.theme', 'dark'));
  await page.goto(`${APP}/`);
  await page.getByRole('link', { name: 'homelab' }).waitFor();
  await shot(page, 'dashboard-dark');

  await browser.close();
  console.log(`screenshots written to ${OUT}`);
} finally {
  server.kill();
  await cf.close();
}
