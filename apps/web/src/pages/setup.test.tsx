import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { SetupPage } from './setup';

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('SetupPage', () => {
  it('blocks short passwords before calling the API', async () => {
    const calls = mockApi({ 'GET /api/setup/status': () => json({ adminCreated: false, cloudflareConnected: false }) });
    renderWithProviders(<SetupPage />);
    await userEvent.type(await screen.findByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create admin' }));
    expect(await screen.findByText('At least 12 characters')).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /api/setup/admin')).toBe(false);
  });

  it('blocks mismatched passwords', async () => {
    mockApi({ 'GET /api/setup/status': () => json({ adminCreated: false, cloudflareConnected: false }) });
    renderWithProviders(<SetupPage />);
    await userEvent.type(await screen.findByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'a-very-long-password');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'another-long-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create admin' }));
    expect(await screen.findByText('Passwords do not match')).toBeTruthy();
  });

  it('shows the token step with a prefilled Cloudflare link', async () => {
    mockApi({
      'GET /api/setup/status': () => json({ adminCreated: true, cloudflareConnected: false }),
      'GET /api/auth/me': () => json({ username: 'admin' }),
    });
    renderWithProviders(<SetupPage />);
    const link = await screen.findByRole('link', { name: /Create token in Cloudflare/ });
    expect(screen.getByText('Account → Account Settings → Read')).toBeTruthy();
    expect(link.getAttribute('href')).toContain('permissionGroupKeys');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows which account lacks the permission and what Cloudflare answered', async () => {
    mockApi({
      'GET /api/setup/status': () => json({ adminCreated: true, cloudflareConnected: false }),
      'GET /api/auth/me': () => json({ username: 'admin' }),
      'POST /api/cloudflare/token': () =>
        json({
          code: 'CF_PERMISSION_MISSING', message: 'x',
          details: { permission: 'Account: Cloudflare Tunnel: Edit', accountName: 'AUTOMATIZA', cloudflare: [{ code: 10000, message: 'Authentication error' }] },
        }, 403),
    });
    renderWithProviders(<SetupPage />);
    await userEvent.type(await screen.findByLabelText('API token'), 'x'.repeat(40));
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/on account "AUTOMATIZA"/)).toBeTruthy();
    expect(screen.getByText(/Cloudflare: 10000 Authentication error/)).toBeTruthy();
  });

  it('connects to every account the token reaches', async () => {
    let connected = false;
    const calls = mockApi({
      'GET /api/setup/status': () => json({ adminCreated: true, cloudflareConnected: connected }),
      'GET /api/auth/me': () => json({ username: 'admin' }),
      'PUT /api/cloudflare/accounts': () => json({ connected: true, tokenSuffix: 'abcd', lastAccountId: null, accounts: [] }),
      'POST /api/cloudflare/token': () => {
        connected = true;
        return json({
          connected: true, tokenSuffix: 'abcd', lastAccountId: null,
          accounts: [
            { id: 'a'.repeat(32), name: 'UPCAST', enabled: true, zones: [{ id: '1', name: 'upcast.com' }] },
            { id: 'b'.repeat(32), name: 'INTERCASE', enabled: true, zones: [{ id: '2', name: 'cloudhub.com.br' }, { id: '3', name: 'intercase.com' }] },
          ],
        });
      },
    });
    renderWithProviders(<SetupPage />);
    await userEvent.type(await screen.findByLabelText('API token'), 'x'.repeat(40));
    expect(screen.queryByRole('combobox', { name: 'Account' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Connected to 2 accounts')).toBeTruthy();
    expect(screen.getByText('UPCAST, INTERCASE · 3 domains')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/cloudflare/token')!.body).toEqual({ token: 'x'.repeat(40) });
    // Several accounts: choose which ones the app works with.
    expect((screen.getByRole('checkbox', { name: /UPCAST/ }) as HTMLInputElement).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('checkbox', { name: /INTERCASE/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save accounts' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'PUT /api/cloudflare/accounts')?.body).toEqual({ enabled: ['a'.repeat(32)] }));
  });
});
