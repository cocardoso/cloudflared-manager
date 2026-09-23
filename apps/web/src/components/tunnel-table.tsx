import { Button, Link, Table, Text, Toast } from '@cloudflare/kumo';
import type { TunnelSummary } from '@tm/shared';
import { useTranslation } from 'react-i18next';
import { useErrorMessage, useTunnelAction } from '../api/hooks';
import { coloCodes, formatDuration } from '../lib/format';
import { StatusBadge } from './status-badge';

function AdoptButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const adopt = useTunnelAction(id);
  const toasts = Toast.useToastManager();
  const msg = useErrorMessage();
  return (
    <Button
      size="sm"
      loading={adopt.isPending}
      onClick={() =>
        adopt.mutate('adopt', {
          onSuccess: () => toasts.add({ title: t('dashboard.adopted') }),
          onError: (e) => toasts.add({ title: msg(e), type: 'error' }),
        })
      }
    >
      {t('dashboard.adopt')}
    </Button>
  );
}

export function TunnelTable({ tunnels, showAccount = false }: { tunnels: TunnelSummary[]; showAccount?: boolean }) {
  const { t } = useTranslation();
  return (
    <Table>
      <Table.Header>
        <Table.Row>
          <Table.Head>{t('dashboard.name')}</Table.Head>
          {showAccount && <Table.Head>{t('dashboard.account')}</Table.Head>}
          <Table.Head>{t('dashboard.status')}</Table.Head>
          <Table.Head>{t('dashboard.connections')}</Table.Head>
          <Table.Head>{t('dashboard.routes')}</Table.Head>
          <Table.Head>{t('dashboard.uptime')}</Table.Head>
          <Table.Head>{t('dashboard.keepAlive')}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {tunnels.map((tn) => {
          const colos = coloCodes(tn.connections.map((c) => c.coloName));
          return (
            <Table.Row key={tn.id} className={tn.managedHere ? undefined : 'opacity-70'}>
              <Table.Cell>
                <div className="flex flex-col">
                  <Link href={`/tunnels/${tn.id}`}>{tn.name}</Link>
                  <Text variant="mono-secondary">{tn.id.slice(0, 8)}</Text>
                </div>
              </Table.Cell>
              {showAccount && <Table.Cell>{tn.account.name}</Table.Cell>}
              <Table.Cell>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge kind="edge" value={tn.edgeStatus} />
                  {tn.managedHere && tn.local !== 'active' && <StatusBadge kind="local" value={tn.local} />}
                </div>
              </Table.Cell>
              <Table.Cell>{colos.length ? <Text variant="mono">{colos.join(' · ')}</Text> : <Text variant="secondary">—</Text>}</Table.Cell>
              <Table.Cell>{tn.managedHere ? tn.routeCount : '—'}</Table.Cell>
              <Table.Cell>{formatDuration(tn.activeSince) ?? '—'}</Table.Cell>
              <Table.Cell>
                {tn.managedHere ? (
                  <StatusBadge kind="watchdog" value={tn.watchdog} />
                ) : tn.remote ? (
                  <AdoptButton id={tn.id} />
                ) : (
                  <StatusBadge kind="local" value="not-installed" />
                )}
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}
