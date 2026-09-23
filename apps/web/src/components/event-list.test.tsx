import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { renderWithProviders } from '../test/utils';
import { EventList } from './event-list';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('EventList', () => {
  it('names deleted tunnels from the name kept on the event', () => {
    renderWithProviders(
      <EventList
        names={{ t2: 'lab' }}
        events={[
          { id: 2, tunnelId: 't1', tunnelName: 'home', type: 'deleted', message: 'Tunnel deleted', createdAt: new Date().toISOString() },
          { id: 1, tunnelId: 't2', tunnelName: 'old-name', type: 'stopped', message: 'Tunnel stopped', createdAt: new Date().toISOString() },
        ]}
      />,
    );
    expect(screen.getByText('home')).toBeTruthy();
    // The current name wins over the recorded one.
    expect(screen.getByText('lab')).toBeTruthy();
    expect(screen.queryByText('old-name')).toBeNull();
  });
});
