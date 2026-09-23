import { Text } from '@cloudflare/kumo';
import type { EventType, TunnelEvent } from '@tm/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatRelative } from '../lib/format';

const DOT: Partial<Record<EventType, string>> = {
  'watchdog-degraded': 'bg-kumo-warning', 'no-connectivity': 'bg-kumo-warning', 'watchdog-restart': 'bg-kumo-warning',
  'watchdog-failing': 'bg-kumo-danger', deleted: 'bg-kumo-danger',
  'watchdog-recovered': 'bg-kumo-success', created: 'bg-kumo-success', started: 'bg-kumo-success', adopted: 'bg-kumo-success',
};

export function EventList({ events, names }: { events: TunnelEvent[]; names?: Record<string, string> }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? 'en';
  if (!events.length) return <Text variant="secondary">{t('dashboard.noEvents')}</Text>;
  return (
    <ol className="flex flex-col">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 border-b border-kumo-hairline py-2.5 last:border-0">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[e.type] ?? 'bg-kumo-info'}`} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Text bold size="sm">{t(`events.${e.type}`)}</Text>
              {names && e.tunnelId && names[e.tunnelId] && <Text variant="secondary" size="sm">{names[e.tunnelId]}</Text>}
            </div>
            <Text variant="secondary" size="sm">{e.message}</Text>
          </div>
          <time className="shrink-0 text-xs text-kumo-subtle" dateTime={e.createdAt} title={formatDateTime(e.createdAt, lng)}>
            {formatRelative(e.createdAt, lng)}
          </time>
        </li>
      ))}
    </ol>
  );
}
