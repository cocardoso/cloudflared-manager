import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { json, mockApi, renderWithProviders } from '../../test/utils';
import { LogsTab } from './logs-tab';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
  // jsdom has no EventSource; the tab only needs one that stays quiet.
  vi.stubGlobal('EventSource', class { onopen = null; onmessage = null; onerror = null; close() {} });
});

describe('LogsTab', () => {
  it('keeps the toolbar on one line: the level filter has no label above it', async () => {
    mockApi({ [`GET /api/tunnels/${ID}/logs`]: () => json([]) });
    renderWithProviders(<LogsTab tunnelId={ID} />);
    expect(await screen.findByRole('combobox', { name: 'Level' })).toBeTruthy();
    expect(screen.queryByText('Level')).toBeNull();
  });
});
