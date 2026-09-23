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
    expect(link.getAttribute('href')).toContain('permissionGroupKeys');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('asks to choose an account when the token has several', async () => {
    let connected = false;
    const calls = mockApi({
      'GET /api/setup/status': () => json({ adminCreated: true, cloudflareConnected: connected }),
      'GET /api/auth/me': () => json({ username: 'admin' }),
      'POST /api/cloudflare/token': (init) => {
        const b = JSON.parse(String(init!.body));
        if (!b.accountId) {
          return json({ code: 'ACCOUNT_SELECTION_REQUIRED', message: 'x', details: { accounts: [{ id: 'a'.repeat(32), name: 'Home' }, { id: 'b'.repeat(32), name: 'Work' }] } }, 409);
        }
        connected = true;
        return json({ connected: true, accountId: b.accountId, accountName: 'Home', tokenSuffix: 'abcd', zones: [{ id: '1', name: 'example.com' }] });
      },
    });
    renderWithProviders(<SetupPage />);
    await userEvent.type(await screen.findByLabelText('API token'), 'x'.repeat(40));
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('This token has access to several accounts. Choose one.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Connected to Home')).toBeTruthy();
    expect(screen.getByText('1 domain found')).toBeTruthy();
    const posts = calls.filter((c) => c.key === 'POST /api/cloudflare/token');
    await waitFor(() => expect(posts.at(-1)!.body).toMatchObject({ accountId: 'a'.repeat(32) }));
  });
});
