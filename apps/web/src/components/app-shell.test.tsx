import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { AppShell } from './app-shell';

beforeEach(async () => {
  vi.restoreAllMocks();
  // The sidebar reads media queries; jsdom does not implement them.
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.getAnimations ??= () => [];
  await i18n.changeLanguage('en');
});

describe('AppShell', () => {
  it('says the app is not a Cloudflare product', async () => {
    mockApi({
      'GET /api/auth/me': () => json({ username: 'admin' }),
      'GET /api/system/cloudflared': () => json({ installed: '2026.9.1', latest: '2026.9.1', updateAvailable: false, canSelfUpdate: true }),
    });
    renderWithProviders(<AppShell />);
    expect(await screen.findByText(/not affiliated with, endorsed or supported by Cloudflare, Inc\./)).toBeTruthy();
  });
  it('shows progress while logging out', async () => {
    mockApi({
      'GET /api/auth/me': () => json({ username: 'admin' }),
      'GET /api/system/cloudflared': () => json({ installed: '2026.9.1', latest: '2026.9.1', updateAvailable: false, canSelfUpdate: true }),
      'POST /api/auth/logout': () => new Promise<Response>(() => {}),
    });
    renderWithProviders(<AppShell />);
    const out = (await screen.findAllByRole('button', { name: 'Log out' }))[0]!;
    await userEvent.click(out);
    await waitFor(() => expect(within(out).getByRole('status')).toBeTruthy());
  });
});
