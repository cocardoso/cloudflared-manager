import type { TunnelEvent } from '@tm/shared';
import type { TFunction } from 'i18next';

/**
 * Server event messages are English; this extracts the useful part and translates it.
 * Returns null when the translated event type already says everything.
 */
export function eventDetail(e: TunnelEvent, t: TFunction): string | null {
  const routes = /^Routes updated \(\+(\d+) \/ -(\d+)\)(?:; failed to remove DNS for (.+))?$/.exec(e.message);
  if (routes) {
    const base = t('eventDetail.routes', { added: routes[1], removed: routes[2] });
    return routes[3] ? `${base} · ${routes[3]}` : base;
  }
  const attempt = /^Restart attempt (\d+)\/(\d+)$/.exec(e.message);
  if (attempt) return t('eventDetail.attempt', { n: attempt[1], max: attempt[2] });
  const version = /^cloudflared is now (.+)$/.exec(e.message);
  if (version) return version[1]!;
  if (e.message === 'Tunnel settings updated') return t('eventDetail.settings');
  if (e.message.startsWith('Watchdog error:')) return e.message;
  return null;
}
