import type { TunnelEvent } from '@tm/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { eventDetail } from './event-detail';

const ev = (type: TunnelEvent['type'], message: string): TunnelEvent => ({ id: 1, tunnelId: null, tunnelName: null, type, message, createdAt: '' });
const t = i18n.t.bind(i18n);

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

describe('eventDetail', () => {
  it('translates route updates', () => {
    expect(eventDetail(ev('config-changed', 'Routes updated (+2 / -1)'), t)).toBe('2 adicionados, 1 removidos');
  });
  it('keeps DNS removal failures visible', () => {
    expect(eventDetail(ev('config-changed', 'Routes updated (+0 / -1); failed to remove DNS for a.example.com'), t))
      .toBe('0 adicionados, 1 removidos · a.example.com');
  });
  it('translates restart attempts and versions', () => {
    expect(eventDetail(ev('watchdog-restart', 'Restart attempt 2/5'), t)).toBe('Tentativa 2 de 5');
    expect(eventDetail(ev('cloudflared-updated', 'cloudflared is now 2026.10.0'), t)).toBe('2026.10.0');
  });
  it('shows raw watchdog errors and hides redundant messages', () => {
    expect(eventDetail(ev('watchdog-degraded', 'Watchdog error: boom'), t)).toBe('Watchdog error: boom');
    expect(eventDetail(ev('stopped', 'Tunnel stopped'), t)).toBeNull();
    expect(eventDetail(ev('created', 'Tunnel "home" created'), t)).toBeNull();
  });
});
