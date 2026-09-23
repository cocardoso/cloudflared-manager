import { act, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import type { TunnelDetail } from '@tm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { json, mockApi, renderWithProviders } from '../../test/utils';
import { SettingsTab } from './settings-tab';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';
const tunnel: TunnelDetail = {
  id: ID, name: 'home', createdAt: '', remote: true, managedHere: true, edgeStatus: 'healthy', connections: [],
  local: 'active', activeSince: null, watchdog: 'healthy', routeCount: 0,
  settings: { keepAlive: true, toleranceMinutes: 2, logLevel: 'info', protocol: 'auto', metricsPort: 20241 },
  routes: [], configVersion: 1,
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('SettingsTab', () => {
  it('sends only changed fields', async () => {
    const calls = mockApi({ [`PATCH /api/tunnels/${ID}`]: () => json(tunnel) });
    renderWithProviders(<SettingsTab tunnel={tunnel} />);
    const tol = screen.getByLabelText('Tolerance (minutes)');
    await userEvent.clear(tol);
    await userEvent.type(tol, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({ toleranceMinutes: 5 }));
  });
  it('toggles keep-alive', async () => {
    const calls = mockApi({ [`PATCH /api/tunnels/${ID}`]: () => json(tunnel) });
    renderWithProviders(<SettingsTab tunnel={tunnel} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Keep-alive' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({ keepAlive: false }));
  });
  it('requires typing the name before deleting', async () => {
    const calls = mockApi({ [`DELETE /api/tunnels/${ID}`]: () => new Response(null, { status: 204 }) });
    renderWithProviders(<SettingsTab tunnel={tunnel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete tunnel' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete tunnel' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await userEvent.type(within(dialog).getByLabelText('Type home to confirm'), 'home');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.map((c) => c.key)).toContain(`DELETE /api/tunnels/${ID}`));
  });
  it('returns to the dashboard even if the tab unmounts while deleting', async () => {
    let hide: () => void = () => undefined;
    function Harness() {
      const [shown, setShown] = useState(true);
      hide = () => setShown(false);
      return shown ? <SettingsTab tunnel={tunnel} /> : <p>tab gone</p>;
    }
    mockApi({
      [`DELETE /api/tunnels/${ID}`]: () => {
        // The tunnel page drops this tab as soon as the tunnel stops being "managed here".
        act(() => hide());
        return new Response(null, { status: 204 });
      },
    });
    renderWithProviders(
      <Routes>
        <Route path="/" element={<p>dashboard page</p>} />
        <Route path="/tunnels/:id" element={<Harness />} />
      </Routes>,
      { route: `/tunnels/${ID}` },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete tunnel' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Type home to confirm'), 'home');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete tunnel' }));
    expect(await screen.findByText('dashboard page')).toBeTruthy();
  });
});
