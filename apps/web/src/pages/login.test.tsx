import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { LoginPage } from './login';

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('LoginPage', () => {
  it('shows translated error on wrong password', async () => {
    mockApi({
      'GET /api/setup/status': () => json({ adminCreated: true, cloudflareConnected: true }),
      'POST /api/auth/login': () => json({ code: 'INVALID_CREDENTIALS', message: 'x' }, 401),
    });
    renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.type(await screen.findByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Wrong username or password.')).toBeTruthy();
  });
});
