import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TunnelDetail } from '@tm/shared';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { json, mockApi, renderWithProviders } from '../../test/utils';
import { RoutesTab } from './routes-tab';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';
const tunnel: TunnelDetail = {
  id: ID, name: 'home', createdAt: '', remote: true, managedHere: true, edgeStatus: 'healthy', connections: [],
  local: 'active', activeSince: null, watchdog: 'healthy', routeCount: 1,
  settings: { keepAlive: true, toleranceMinutes: 2, logLevel: 'info', protocol: 'auto', metricsPort: 20241 },
  routes: [{ hostname: 'ha.example.com', service: 'http://10.0.0.5:8123' }], configVersion: 4,
};
const cfStatus = { connected: true, accountId: 'a', accountName: 'Home', tokenSuffix: 'abcd', zones: [{ id: 'z1', name: 'example.com' }, { id: 'z2', name: 'other.dev' }] };

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('RoutesTab', () => {
  it('lists routes above the catch-all rule', async () => {
    mockApi({ 'GET /api/cloudflare/status': () => json(cfStatus) });
    renderWithProviders(<RoutesTab tunnel={tunnel} />);
    const rows = await screen.findAllByRole('row');
    expect(rows.at(-2)!.textContent).toContain('ha.example.com');
    expect(rows.at(-1)!.textContent).toContain('Everything else returns 404');
  });

  it('adds a route and confirms a DNS overwrite', async () => {
    let attempt = 0;
    const calls = mockApi({
      'GET /api/cloudflare/status': () => json(cfStatus),
      [`PUT /api/tunnels/${ID}/routes`]: () =>
        ++attempt === 1
          ? json({ code: 'DNS_CONFLICT', message: 'x', details: { hostnames: ['git.example.com'] } }, 409)
          : json({ ...tunnel, routes: [...tunnel.routes, { hostname: 'git.example.com', service: 'http://10.0.0.9:3000' }], configVersion: 5 }),
    });
    renderWithProviders(<RoutesTab tunnel={tunnel} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add public hostname' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Subdomain'), 'git');
    await userEvent.type(within(dialog).getByLabelText('URL'), '10.0.0.9:3000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Replace DNS record' }));
    await waitFor(() => expect(calls.filter((c) => c.key.startsWith('PUT')).length).toBe(2));
    const [first, second] = calls.filter((c) => c.key.startsWith('PUT')).map((c) => c.body as { version: number; routes: { hostname: string }[]; overwriteDns?: string[] });
    expect(first!.version).toBe(4);
    expect(first!.routes.map((r) => r.hostname)).toEqual(['ha.example.com', 'git.example.com']);
    expect(second!.overwriteDns).toEqual(['git.example.com']);
  });

  it('removes a route keeping its DNS record when unchecked', async () => {
    const calls = mockApi({
      'GET /api/cloudflare/status': () => json(cfStatus),
      [`PUT /api/tunnels/${ID}/routes`]: () => json({ ...tunnel, routes: [], configVersion: 5 }),
    });
    renderWithProviders(<RoutesTab tunnel={tunnel} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ha.example.com' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Also delete the DNS record' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(true));
    expect(calls.find((c) => c.key.startsWith('PUT'))!.body).toMatchObject({ version: 4, routes: [], keepDns: ['ha.example.com'] });
  });

  it('saves against the version the dialog was opened on, even if data refreshed meanwhile', async () => {
    const two = { ...tunnel, routes: [{ hostname: 'a.example.com', service: 'http://a:1' }, { hostname: 'b.example.com', service: 'http://b:1' }] };
    let setTunnel: (t: TunnelDetail) => void = () => undefined;
    function Harness() {
      const [t, set] = useState<TunnelDetail>(two);
      setTunnel = set;
      return <RoutesTab tunnel={t} />;
    }
    const calls = mockApi({
      'GET /api/cloudflare/status': () => json(cfStatus),
      [`PUT /api/tunnels/${ID}/routes`]: () => json({ code: 'CONFIG_VERSION_CONFLICT', message: 'x', details: { currentVersion: 5 } }, 409),
    });
    renderWithProviders(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove b.example.com' }));
    // A background refetch brings a rule inserted in the Cloudflare dashboard.
    act(() => setTunnel({ ...two, configVersion: 5, routes: [{ hostname: 'x.example.com', service: 'http://x:1' }, ...two.routes] }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(true));
    expect(calls.find((c) => c.key.startsWith('PUT'))!.body).toMatchObject({ version: 4, routes: [{ hostname: 'a.example.com' }] });
    expect(await screen.findByText(/changed elsewhere/)).toBeTruthy();
  });

  it('is read-only for tunnels not managed here', async () => {
    mockApi({ 'GET /api/cloudflare/status': () => json(cfStatus) });
    renderWithProviders(<RoutesTab tunnel={{ ...tunnel, managedHere: false }} />);
    await screen.findByText('ha.example.com');
    expect(screen.queryByRole('button', { name: 'Add public hostname' })).toBeNull();
  });
});
