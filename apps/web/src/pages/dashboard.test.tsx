import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TunnelSummary } from '@tm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { DashboardPage } from './dashboard';

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

const HOME = { id: 'a'.repeat(32), name: 'Home Lab' };
const SECOND = { id: 'b'.repeat(32), name: 'Second Org' };
const oneAccount = { connected: true, tokenSuffix: 'abcd', lastAccountId: null, accounts: [{ ...HOME, zones: [] }] };
const twoAccounts = { connected: true, tokenSuffix: 'abcd', lastAccountId: SECOND.id, accounts: [{ ...HOME, zones: [] }, { ...SECOND, zones: [] }] };
const tunnel = (name: string, account: typeof HOME, id: string): TunnelSummary => ({
  id, name, account, createdAt: '', remote: true, managedHere: true, edgeStatus: 'healthy', connections: [],
  local: 'active', activeSince: null, watchdog: 'healthy', routeCount: 0,
  settings: { keepAlive: true, toleranceMinutes: 2, logLevel: 'info', protocol: 'auto', metricsPort: 20241 },
});
const empty = { tunnels: [], unavailableAccounts: [] };

const common = {
  'GET /api/events': () => json([]),
  'GET /api/cloudflare/status': () => json(oneAccount),
  'GET /api/system/cloudflared': () => json({ installed: '2026.9.1', latest: '2026.10.0', updateAvailable: true }),
};

describe('DashboardPage', () => {
  it('shows empty state and update banner', async () => {
    mockApi({ ...common, 'GET /api/tunnels': () => json(empty) });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('No tunnels yet')).toBeTruthy();
    expect(await screen.findByText(/2026\.10\.0/)).toBeTruthy();
  });
  it('validates the tunnel name and creates it', async () => {
    const calls = mockApi({
      ...common,
      'GET /api/tunnels': () => json(empty),
      'POST /api/tunnels': () => json({ id: '6ff42ae2-765d-4adf-8112-31c55c1551ef', name: 'home' }, 201),
    });
    renderWithProviders(<DashboardPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Create tunnel' }))[0]!);
    await userEvent.type(await screen.findByLabelText('Tunnel name'), 'bad name');
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);
    await userEvent.clear(screen.getByLabelText('Tunnel name'));
    await userEvent.type(screen.getByLabelText('Tunnel name'), 'home');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(calls.find((c) => c.key === 'POST /api/tunnels')?.body).toEqual({ name: 'home' });
  });

  it('shows, filters and counts tunnels per account when the token reaches several', async () => {
    mockApi({
      ...common,
      'GET /api/cloudflare/status': () => json(twoAccounts),
      'GET /api/tunnels': () => json({
        tunnels: [tunnel('home', HOME, '6ff42ae2-765d-4adf-8112-31c55c1551ef'), tunnel('work', SECOND, '7ff42ae2-765d-4adf-8112-31c55c1551ef')],
        unavailableAccounts: [],
      }),
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('columnheader', { name: 'Account' })).toBeTruthy();
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['home', 'work']);
    await userEvent.click(screen.getByRole('combobox', { name: 'Account' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Second Org' }));
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['work']);
    const healthy = document.querySelector('[data-card="healthy"]') as HTMLElement;
    expect(healthy.textContent).toBe('Healthy1');
  });
  it('hides the account column and filter with a single account', async () => {
    mockApi({ ...common, 'GET /api/tunnels': () => json({ tunnels: [tunnel('home', HOME, '6ff42ae2-765d-4adf-8112-31c55c1551ef')], unavailableAccounts: [] }) });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('link', { name: 'home' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Account' })).toBeNull();
  });
  it('warns about accounts whose tunnels could not be loaded', async () => {
    mockApi({
      ...common,
      'GET /api/cloudflare/status': () => json(twoAccounts),
      'GET /api/tunnels': () => json({ tunnels: [tunnel('home', HOME, '6ff42ae2-765d-4adf-8112-31c55c1551ef')], unavailableAccounts: [{ ...SECOND, code: 'CF_PERMISSION_MISSING' }] }),
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/Could not load tunnels from Second Org/)).toBeTruthy();
  });
  it('creates the tunnel in the chosen account, starting from the last one used', async () => {
    const calls = mockApi({
      ...common,
      'GET /api/cloudflare/status': () => json(twoAccounts),
      'GET /api/tunnels': () => json(empty),
      'POST /api/tunnels': () => json({ id: '6ff42ae2-765d-4adf-8112-31c55c1551ef', name: 'home' }, 201),
    });
    renderWithProviders(<DashboardPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Create tunnel' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Account' }).textContent).toContain('Second Org');
    await userEvent.type(within(dialog).getByLabelText('Tunnel name'), 'home');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(calls.find((c) => c.key === 'POST /api/tunnels')?.body).toEqual({ name: 'home', accountId: SECOND.id });
  });
});
