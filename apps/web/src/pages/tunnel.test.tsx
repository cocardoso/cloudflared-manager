import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TunnelDetail } from '@tm/shared';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { TunnelPage } from './tunnel';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';
const tunnel: TunnelDetail = {
  id: ID, name: 'home', account: { id: 'a'.repeat(32), name: 'Home Lab' }, createdAt: '', remote: true, managedHere: true, edgeStatus: 'healthy', connections: [],
  local: 'active', activeSince: null, watchdog: 'failing', routeCount: 0,
  settings: { keepAlive: true, toleranceMinutes: 2, logLevel: 'info', protocol: 'auto', metricsPort: 20241 },
  routes: [], configVersion: 1,
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

const page = () => (
  <Routes>
    <Route path="/tunnels/:id" element={<TunnelPage />} />
  </Routes>
);

describe('TunnelPage', () => {
  it('shows watchdog banner and restarts the tunnel', async () => {
    const calls = mockApi({
      [`GET /api/tunnels/${ID}`]: () => json(tunnel),
      'GET /api/cloudflare/status': () => json({ connected: true, tokenSuffix: 'abcd', lastAccountId: null, accounts: [] }),
      [`POST /api/tunnels/${ID}/restart`]: () => new Response(null, { status: 204 }),
    });
    renderWithProviders(page(), { route: `/tunnels/${ID}` });
    expect(await screen.findByText(/The watchdog gave up/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(calls.map((c) => c.key)).toContain(`POST /api/tunnels/${ID}/restart`);
  });
  it('names the account when the token reaches several', async () => {
    mockApi({
      [`GET /api/tunnels/${ID}`]: () => json(tunnel),
      'GET /api/cloudflare/status': () => json({
        connected: true, tokenSuffix: 'abcd', lastAccountId: null,
        accounts: [{ id: 'a'.repeat(32), name: 'Home Lab', enabled: true, zones: [] }, { id: 'b'.repeat(32), name: 'Second Org', enabled: true, zones: [] }],
      }),
    });
    renderWithProviders(page(), { route: `/tunnels/${ID}` });
    expect(await screen.findByText('Home Lab')).toBeTruthy();
  });
  it('offers to run a foreign tunnel here', async () => {
    mockApi({
      [`GET /api/tunnels/${ID}`]: () => json({ ...tunnel, managedHere: false, local: 'not-installed', watchdog: 'disabled', settings: null }),
      'GET /api/cloudflare/status': () => json({ connected: true, tokenSuffix: 'abcd', lastAccountId: null, accounts: [] }),
    });
    renderWithProviders(page(), { route: `/tunnels/${ID}` });
    expect(await screen.findByText('This tunnel exists in your account but does not run on this host.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run here' })).toBeTruthy();
  });
});
