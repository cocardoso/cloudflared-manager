import { ChartPalette, ClipboardText, LayerCard, Table, Text, TimeseriesChart } from '@cloudflare/kumo';
import type { TunnelDetail } from '@tm/shared';
import * as echarts from 'echarts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTunnelMetrics } from '../../api/hooks';
import { formatDateTime } from '../../lib/format';
import { useIsDark } from '../../lib/use-is-dark';

export function StatusTab({ tunnel }: { tunnel: TunnelDetail }) {
  const { t, i18n } = useTranslation();
  const dark = useIsDark();
  const metrics = useTunnelMetrics(tunnel.id);
  const points = metrics.data?.points ?? [];
  const version = tunnel.connections[0]?.clientVersion;
  const details: [string, string, ReactNode][] = [
    ['id', t('tunnel.tunnelId'), <div className="max-w-md"><ClipboardText text={tunnel.id} /></div>],
    ['account', t('dashboard.account'), <Text>{tunnel.account.name || '—'}</Text>],
    ['version', t('tunnel.version'), <Text variant="mono">{version || '—'}</Text>],
    ['created', t('tunnel.createdAt'), <Text>{tunnel.createdAt ? formatDateTime(tunnel.createdAt, i18n.resolvedLanguage ?? 'en') : '—'}</Text>],
  ];

  return (
    <div className="flex flex-col gap-6">
      <LayerCard>
        <LayerCard.Secondary>{t('tunnel.details')}</LayerCard.Secondary>
        <LayerCard.Primary>
          {/* Label/value rows share one grid so every value lines up, whatever its height. */}
          <dl className="grid grid-cols-1 items-center gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
            {details.map(([key, label, value]) => (
              <div key={key} data-detail={key} className="contents">
                <dt><Text variant="secondary" size="sm">{label}</Text></dt>
                <dd className="min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
        </LayerCard.Primary>
      </LayerCard>

      <LayerCard className="overflow-x-auto p-0">
        <LayerCard.Secondary className="px-4 py-3">{t('tunnel.connectionsTitle')}</LayerCard.Secondary>
        {tunnel.connections.length === 0 ? (
          <div className="p-4"><Text variant="secondary">{t('tunnel.noConnections')}</Text></div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>{t('tunnel.colo')}</Table.Head>
                <Table.Head>{t('tunnel.openedAt')}</Table.Head>
                <Table.Head>{t('tunnel.originIp')}</Table.Head>
                <Table.Head>{t('tunnel.clientVersion')}</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {tunnel.connections.map((c, i) => (
                <Table.Row key={`${c.coloName}-${i}`}>
                  <Table.Cell><Text variant="mono">{c.coloName.toUpperCase()}</Text></Table.Cell>
                  <Table.Cell>{c.openedAt ? formatDateTime(c.openedAt, i18n.resolvedLanguage ?? 'en') : '—'}</Table.Cell>
                  <Table.Cell><Text variant="mono">{c.originIp || '—'}</Text></Table.Cell>
                  <Table.Cell><Text variant="mono">{c.clientVersion || '—'}</Text></Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </LayerCard>

      {tunnel.managedHere && (
        <LayerCard>
          <LayerCard.Secondary>{t('tunnel.traffic')}</LayerCard.Secondary>
          <LayerCard.Primary>
            {points.length < 2 ? (
              <Text variant="secondary">{t('tunnel.metricsEmpty')}</Text>
            ) : (
              <TimeseriesChart
                echarts={echarts}
                isDarkMode={dark}
                height={260}
                type="line"
                data={[
                  { name: t('tunnel.requests'), color: ChartPalette.categorical(0, dark), data: points.map((p) => [p.t, p.requests]) },
                  { name: t('tunnel.errors'), color: ChartPalette.semantic('Attention', dark), data: points.map((p) => [p.t, p.errors]) },
                ]}
              />
            )}
          </LayerCard.Primary>
        </LayerCard>
      )}
    </div>
  );
}
