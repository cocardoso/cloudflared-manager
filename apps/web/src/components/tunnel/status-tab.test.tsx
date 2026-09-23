import { screen } from '@testing-library/react';
import type { TunnelDetail } from '@tm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { json, mockApi, renderWithProviders } from '../../test/utils';
import { StatusTab } from './status-tab';

const ID = '851081dc-0491-4846-929f-f2d26fc29b84';
const tunnel: TunnelDetail = {
  id: ID, name: 'home', account: { id: 'a'.repeat(32), name: 'Home Lab' }, createdAt: '2026-09-01T12:00:00Z', remote: true, managedHere: true,
  edgeStatus: 'healthy', connections: [{ coloName: 'gru01', openedAt: '', originIp: '10.0.0.2', clientVersion: '2026.6.1' }],
  local: 'active', activeSince: null, watchdog: 'healthy', routeCount: 0,
  settings: { keepAlive: true, toleranceMinutes: 2, logLevel: 'info', protocol: 'auto', metricsPort: 20241 }, routes: [], configVersion: 1,
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('StatusTab', () => {
  it('lists the tunnel details as aligned label/value rows in one card', async () => {
    mockApi({ [`GET /api/tunnels/${ID}/metrics`]: () => json({ points: [], haConnections: null }) });
    renderWithProviders(<StatusTab tunnel={tunnel} />);
    const rows = Object.fromEntries(
      [...document.querySelectorAll('[data-detail]')].map((r) => [r.getAttribute('data-detail'), r.textContent]),
    );
    expect(Object.keys(rows)).toEqual(['id', 'account', 'version', 'created']);
    expect(rows.id).toContain(ID);
    expect(rows.account).toContain('Home Lab');
    expect(rows.version).toContain('2026.6.1');
    expect(screen.getByText('Details')).toBeTruthy();
  });
});
