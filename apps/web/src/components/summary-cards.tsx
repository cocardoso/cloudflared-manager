import { Grid, LayerCard, Text } from '@cloudflare/kumo';
import type { TunnelSummary } from '@tm/shared';
import { useTranslation } from 'react-i18next';

/** Counts only tunnels running on this host. */
export function summarize(tunnels: TunnelSummary[]) {
  const out = { healthy: 0, degraded: 0, stopped: 0, failing: 0, routes: 0 };
  for (const t of tunnels) {
    if (!t.managedHere) continue;
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
  { key: 'stopped', dot: 'bg-kumo-inactive' },
  { key: 'failing', dot: 'bg-kumo-danger' },
] as const;

export function SummaryCards({ tunnels }: { tunnels: TunnelSummary[] }) {
  const { t } = useTranslation();
  const s = summarize(tunnels);
  return (
    <Grid variant="4up" gap="base">
      {CARDS.map((c) => (
        <LayerCard key={c.key}>
          <LayerCard.Primary>
            <div className="flex flex-col gap-1 p-1">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${c.dot}`} />
                <Text variant="secondary" size="sm">{t(`dashboard.${c.key}`)}</Text>
              </div>
              <span className="font-heading text-3xl font-semibold tabular-nums text-kumo-default">{s[c.key]}</span>
            </div>
          </LayerCard.Primary>
        </LayerCard>
      ))}
    </Grid>
  );
}
