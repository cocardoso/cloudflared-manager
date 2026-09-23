import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { DashboardPage } from './dashboard';

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

const common = {
  'GET /api/events': () => json([]),
  'GET /api/system/cloudflared': () => json({ installed: '2026.9.1', latest: '2026.10.0', updateAvailable: true }),
};

describe('DashboardPage', () => {
  it('shows empty state and update banner', async () => {
    mockApi({ ...common, 'GET /api/tunnels': () => json([]) });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('No tunnels yet')).toBeTruthy();
    expect(await screen.findByText(/2026\.10\.0/)).toBeTruthy();
  });
  it('validates the tunnel name and creates it', async () => {
    const calls = mockApi({
      ...common,
      'GET /api/tunnels': () => json([]),
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
});
