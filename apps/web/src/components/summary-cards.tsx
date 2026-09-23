import { LayerCard, Text } from '@cloudflare/kumo';
import { WarningIcon } from '@phosphor-icons/react';
import type { TunnelSummary } from '@tm/shared';
import { useTranslation } from 'react-i18next';

/** Buckets tunnels running on this host by health; the rest are only counted as `notHere`. */
export function summarize(tunnels: TunnelSummary[]) {
  const out = { healthy: 0, degraded: 0, stopped: 0, failing: 0, notHere: 0, routes: 0 };
  for (const t of tunnels) {
    if (!t.managedHere) {
      out.notHere++;
      continue;
    }
    out.routes += t.routeCount;
    if (t.watchdog === 'failing' || t.local === 'failed') out.failing++;
    else if (t.local === 'inactive') out.stopped++;
    else if (t.edgeStatus === 'healthy' && t.local === 'active') out.healthy++;
    else out.degraded++;
  }
  return out;
}

const CARDS = [
  { key: 'healthy', dot: 'bg-kumo-success' },
  { key: 'degraded', dot: 'bg-kumo-warning' },
  { key: 'stopped', dot: 'bg-current text-kumo-subtle' },
  { key: 'failing', dot: 'bg-kumo-danger' },
  { key: 'notHere', dot: null },
] as const;

export function SummaryCards({ tunnels }: { tunnels: TunnelSummary[] }) {
  const { t } = useTranslation();
  const s = summarize(tunnels);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
      {CARDS.map((c) => (
        <LayerCard key={c.key} data-card={c.key} className="h-full">
          <LayerCard.Primary>
            <div className="flex flex-col gap-1 p-1">
              <div className="flex items-center gap-2">
                {c.dot ? (
                  <span className={`size-2 rounded-full ${c.dot}`} />
                ) : (
                  <WarningIcon weight="fill" className="size-4 text-kumo-warning" aria-hidden />
                )}
                <Text variant="secondary" size="sm">{t(`dashboard.${c.key}`)}</Text>
              </div>
              <span className="font-heading text-3xl font-semibold tabular-nums text-kumo-default">{s[c.key]}</span>
            </div>
          </LayerCard.Primary>
        </LayerCard>
      ))}
    </div>
  );
}
