import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { SettingsPage } from './settings';

const routes = {
  'GET /api/cloudflare/status': () => json({ connected: true, accountId: 'a', accountName: 'Home Lab', tokenSuffix: 'abcd', zones: [{ id: '1', name: 'example.com' }] }),
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
  it('shows account, token suffix and domains', async () => {
    mockApi(routes);
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText('Token ending in abcd')).toBeTruthy();
    expect(screen.getByText('Home Lab')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
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
  it('rejects a short new password locally', async () => {
    const calls = mockApi(routes);
    renderWithProviders(<SettingsPage />);
    await userEvent.type(await screen.findByLabelText('Current password'), 'a-very-long-password');
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    expect(screen.getByRole('button', { name: 'Change password' }).hasAttribute('disabled')).toBe(true);
    expect(calls.some((c) => c.key === 'POST /api/auth/password')).toBe(false);
  });
  it('switches language', async () => {
    mockApi(routes);
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Token ending in abcd');
    await i18n.changeLanguage('pt-BR');
    expect(await screen.findByRole('heading', { name: 'Configurações' })).toBeTruthy();
  });
});
