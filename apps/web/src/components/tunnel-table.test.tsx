import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TunnelSummary } from '@tm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { json, mockApi, renderWithProviders } from '../test/utils';
import { SummaryCards, summarize } from './summary-cards';
import { TunnelTable } from './tunnel-table';

const base: TunnelSummary = {
  id: '6ff42ae2-765d-4adf-8112-31c55c1551ef', name: 'home', createdAt: '', remote: true, managedHere: true, edgeStatus: 'healthy',
  connections: [
    { coloName: 'gru01', openedAt: '', originIp: '', clientVersion: '' },
    { coloName: 'eze01', openedAt: '', originIp: '', clientVersion: '' },
    { coloName: 'gru02', openedAt: '', originIp: '', clientVersion: '' },
  ],
  local: 'active', activeSince: new Date(Date.now() - 3_600_000).toISOString(), watchdog: 'healthy', routeCount: 3,
  settings: { keepAlive: true, toleranceMinutes: 2, logLevel: 'info', protocol: 'auto', metricsPort: 20241 },
};
const foreign: TunnelSummary = { ...base, id: '7ff42ae2-765d-4adf-8112-31c55c1551ef', name: 'other', managedHere: false, local: 'not-installed', settings: null, watchdog: 'disabled' };

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('summarize', () => {
  it('buckets managed tunnels and counts the ones not on this host apart', () => {
    const s = summarize([base, { ...base, local: 'inactive' }, { ...base, watchdog: 'failing' }, { ...base, edgeStatus: 'degraded' }, foreign, foreign]);
    expect(s).toEqual({ healthy: 1, degraded: 1, stopped: 1, failing: 1, notHere: 2, routes: 12 });
  });
});

describe('SummaryCards', () => {
  it('shows a card with a warning icon for tunnels not on this host', () => {
    renderWithProviders(<SummaryCards tunnels={[base, foreign]} />);
    const card = screen.getByText('Not on this host').closest('[data-card]') as HTMLElement;
    expect(card.getAttribute('data-card')).toBe('notHere');
    expect(card.textContent).toContain('1');
    expect(card.querySelector('svg')).toBeTruthy();
  });
});

describe('TunnelTable', () => {
  it('renders name link, unique colos and uptime', () => {
    renderWithProviders(<TunnelTable tunnels={[base]} />);
    expect(screen.getByRole('link', { name: 'home' }).getAttribute('href')).toBe(`/tunnels/${base.id}`);
    expect(screen.getByText('GRU · EZE')).toBeTruthy();
    expect(screen.getByText('1h 0m')).toBeTruthy();
  });
  it('offers "Run here" for remote tunnels not on this host', async () => {
    const calls = mockApi({ [`POST /api/tunnels/${foreign.id}/adopt`]: () => json({ ...foreign, managedHere: true }) });
    renderWithProviders(<TunnelTable tunnels={[foreign]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run here' }));
    expect(calls.map((c) => c.key)).toContain(`POST /api/tunnels/${foreign.id}/adopt`);
  });
  it('does not offer "Run here" for local-config tunnels', () => {
    renderWithProviders(<TunnelTable tunnels={[{ ...foreign, remote: false }]} />);
    expect(screen.queryByRole('button', { name: 'Run here' })).toBeNull();
  });
});
