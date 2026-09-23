import { ChartPalette, ClipboardText, Grid, LayerCard, Table, Text, TimeseriesChart } from '@cloudflare/kumo';
import type { TunnelDetail } from '@tm/shared';
import * as echarts from 'echarts';
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

  return (
    <div className="flex flex-col gap-6">
      <Grid variant="2up" gap="base">
        <LayerCard>
          <LayerCard.Secondary>{t('tunnel.tunnelId')}</LayerCard.Secondary>
          <LayerCard.Primary><ClipboardText text={tunnel.id} /></LayerCard.Primary>
        </LayerCard>
        <LayerCard>
          <LayerCard.Secondary>{t('tunnel.version')}</LayerCard.Secondary>
          <LayerCard.Primary><Text variant="mono">{version || '—'}</Text></LayerCard.Primary>
        </LayerCard>
      </Grid>

      <LayerCard className="p-0">
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
