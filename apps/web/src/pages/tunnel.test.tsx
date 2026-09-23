import { act, screen, waitFor, within } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
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
  it('closes the hostname dialog as soon as the save answers, without waiting for reloads', async () => {
    let gets = 0;
    let calls: { key: string }[] = [];
    const saved = { ...tunnel, routes: [{ hostname: 'ha.example.com', service: 'http://10.0.0.5:8123' }], routeCount: 1, configVersion: 2 };
    calls = mockApi({
      // The first load answers; any reload after the save never does.
      [`GET /api/tunnels/${ID}`]: () => (gets++ === 0 ? json(tunnel) : new Promise<Response>(() => {})),
      'GET /api/cloudflare/status': () => json({
        connected: true, tokenSuffix: 'abcd', lastAccountId: null,
        accounts: [{ id: 'a'.repeat(32), name: 'Home Lab', enabled: true, zones: [{ id: 'z1', name: 'example.com' }] }],
      }),
      [`PUT /api/tunnels/${ID}/routes`]: () => json(saved),
      [`GET /api/tunnels/${ID}/events`]: () => new Promise<Response>(() => {}),
    });
    renderWithProviders(page(), { route: `/tunnels/${ID}` });
    await userEvent.click(await screen.findByRole('button', { name: 'Add public hostname' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Subdomain'), 'ha');
    await userEvent.type(within(dialog).getByLabelText('URL'), '10.0.0.5:8123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.map((c) => c.key)).toContain(`PUT /api/tunnels/${ID}/routes`));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add public hostname' })).toBeNull());
    expect(screen.getByText('ha.example.com')).toBeTruthy();
  });
  it('keeps the saved hostnames when an older reload lands after the save', async () => {
    let gets = 0;
    let finishStale: (r: Response) => void = () => {};
    const saved = { ...tunnel, routes: [{ hostname: 'ha.example.com', service: 'http://10.0.0.5:8123' }], routeCount: 1, configVersion: 2 };
    mockApi({
      // First load answers; the second (a reload started before the save) only answers later, with old data.
      [`GET /api/tunnels/${ID}`]: () => (gets++ === 0 ? json(tunnel) : new Promise<Response>((r) => (finishStale = r))),
      'GET /api/cloudflare/status': () => json({
        connected: true, tokenSuffix: 'abcd', lastAccountId: null,
        accounts: [{ id: 'a'.repeat(32), name: 'Home Lab', enabled: true, zones: [{ id: 'z1', name: 'example.com' }] }],
      }),
      [`PUT /api/tunnels/${ID}/routes`]: () => json(saved),
      [`GET /api/tunnels/${ID}/events`]: () => new Promise<Response>(() => {}),
    });
    renderWithProviders(page(), { route: `/tunnels/${ID}` });
    await userEvent.click(await screen.findByRole('button', { name: 'Add public hostname' }));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(gets).toBe(2));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Subdomain'), 'ha');
    await userEvent.type(within(dialog).getByLabelText('URL'), '10.0.0.5:8123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('ha.example.com')).toBeTruthy();
    await act(async () => finishStale(json(tunnel)));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('ha.example.com')).toBeTruthy();
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
