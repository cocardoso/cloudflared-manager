import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { SettingsPage } from './settings';

const routes = {
  'GET /api/cloudflare/status': () => json({
    connected: true, tokenSuffix: 'abcd', lastAccountId: null,
    accounts: [
      { id: 'a'.repeat(32), name: 'Home Lab', enabled: true, zones: [{ id: '1', name: 'example.com' }] },
      { id: 'b'.repeat(32), name: 'Second Org', enabled: false, zones: [{ id: '2', name: 'second.net' }] },
    ],
  }),
  'GET /api/system/cloudflared': () => json({ installed: '2026.9.1', latest: '2026.10.0', updateAvailable: true, canSelfUpdate: true }),
  'POST /api/system/cloudflared/update': () => json({ installed: '2026.10.0', latest: '2026.10.0', updateAvailable: false }),
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('SettingsPage', () => {
  it('shows every account with its domains and the token suffix', async () => {
    mockApi(routes);
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText('Token ending in abcd')).toBeTruthy();
    const home = screen.getByText('Home Lab').closest('[data-account]') as HTMLElement;
    expect(home.textContent).toContain('example.com');
    expect(home.textContent).not.toContain('second.net');
    expect((screen.getByText('Second Org').closest('[data-account]') as HTMLElement).textContent).toContain('second.net');
  });
  it('turns accounts on and off', async () => {
    const calls = mockApi({ ...routes, 'PUT /api/cloudflare/accounts': () => json({ code: 'ACCOUNT_IN_USE', message: 'x', details: { accounts: ['Home Lab'] } }, 409) });
    renderWithProviders(<SettingsPage />);
    const second = await screen.findByRole('checkbox', { name: /Second Org/ });
    expect(second.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(second);
    await userEvent.click(screen.getByRole('checkbox', { name: /Home Lab/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save accounts' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'PUT /api/cloudflare/accounts')?.body).toEqual({ enabled: ['b'.repeat(32)] }));
    expect(await screen.findByText(/Tunnels of Home Lab run on this host/)).toBeTruthy();
  });
  it('confirms when the accounts are saved', async () => {
    let enabledSecond = false;
    const status = () => ({
      connected: true, tokenSuffix: 'abcd', lastAccountId: null,
      accounts: [
        { id: 'a'.repeat(32), name: 'Home Lab', enabled: true, zones: [] },
        { id: 'b'.repeat(32), name: 'Second Org', enabled: enabledSecond, zones: [] },
      ],
    });
    mockApi({
      ...routes,
      'GET /api/cloudflare/status': () => json(status()),
      'PUT /api/cloudflare/accounts': () => {
        enabledSecond = true;
        return json(status());
      },
    });
    renderWithProviders(<SettingsPage />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Second Org/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save accounts' }));
    expect(await screen.findByText('Accounts saved')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Second Org/ }).getAttribute('aria-checked')).toBe('true'));
  });
  it('updates cloudflared', async () => {
    const calls = mockApi(routes);
    renderWithProviders(<SettingsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update' }));
    await waitFor(() => expect(calls.map((c) => c.key)).toContain('POST /api/system/cloudflared/update'));
  });
  it('explains image updates when cloudflared cannot be updated in place', async () => {
    mockApi({ ...routes, 'GET /api/system/cloudflared': () => json({ installed: '2026.9.1', latest: '2026.10.0', updateAvailable: true, canSelfUpdate: false }) });
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText(/Pull the latest image/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  });
  it('allows a short new password while showing its strength', async () => {
    const calls = mockApi({ ...routes, 'POST /api/auth/password': () => new Response(null, { status: 204 }) });
    renderWithProviders(<SettingsPage />);
    await userEvent.type(await screen.findByLabelText('Current password'), 'a-very-long-password');
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    expect(screen.getByText('Weak')).toBeTruthy();
    expect(screen.getByText(/Recommended: 12 or more characters/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/auth/password')).toBe(true));
  });
  it('switches language', async () => {
    mockApi(routes);
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Token ending in abcd');
    await i18n.changeLanguage('pt-BR');
    expect(await screen.findByRole('heading', { name: 'Configurações' })).toBeTruthy();
  });
});
