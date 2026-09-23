import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { EventRepo } from './event-repo';

describe('EventRepo', () => {
  it('keeps the tunnel name on every event, even after the tunnel is gone', () => {
    const events = new EventRepo(openDatabase(':memory:'));
    events.add('t1', 'created', 'Tunnel "home" created', 'home');
    events.add('t1', 'stopped', 'Tunnel stopped');
    events.add('t1', 'deleted', 'Tunnel deleted');
    events.add(null, 'cloudflared-updated', 'cloudflared updated');
    expect(events.list().map((e) => [e.type, e.tunnelName])).toEqual([
      ['cloudflared-updated', null], ['deleted', 'home'], ['stopped', 'home'], ['created', 'home'],
    ]);
  });
  it('follows a rename', () => {
    const events = new EventRepo(openDatabase(':memory:'));
    events.add('t1', 'created', 'Tunnel "home" created', 'home');
    events.add('t1', 'config-changed', 'Tunnel settings updated', 'lab');
    events.add('t1', 'deleted', 'Tunnel deleted');
    expect(events.list({ limit: 1 })[0]!.tunnelName).toBe('lab');
  });
});
