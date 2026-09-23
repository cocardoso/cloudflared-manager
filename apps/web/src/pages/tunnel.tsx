import { Badge, Banner, Breadcrumbs, Button, Loader, Tabs, Toast } from '@cloudflare/kumo';
import { ArrowClockwiseIcon, PlayIcon, StopIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { activeAccounts } from '../lib/accounts';
import { useCloudflareStatus, useErrorMessage, useTunnel, useTunnelAction } from '../api/hooks';
import { ErrorBanner } from '../components/error-banner';
import { PageHeader } from '../components/page-header';
import { RoutesTab } from '../components/routes/routes-tab';
import { StatusBadge } from '../components/status-badge';
import { EventsTab } from '../components/tunnel/events-tab';
import { LogsTab } from '../components/tunnel/logs-tab';
import { SettingsTab } from '../components/tunnel/settings-tab';
import { StatusTab } from '../components/tunnel/status-tab';

const TABS = ['routes', 'status', 'logs', 'events', 'settings'] as const;
type Tab = (typeof TABS)[number];

export function TunnelPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tunnel = useTunnel(id);
  const multiAccount = activeAccounts(useCloudflareStatus().data).length > 1;
  const action = useTunnelAction(id);
  const toasts = Toast.useToastManager();
  const msg = useErrorMessage();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'routes';

  const run = (a: 'start' | 'stop' | 'restart' | 'adopt', done: string) =>
    action.mutate(a, {
      onSuccess: () => toasts.add({ title: done }),
      onError: (e) => toasts.add({ title: msg(e), type: 'error' }),
    });

  const breadcrumbs = (
    <Breadcrumbs>
      <Breadcrumbs.Link href="/">{t('dashboard.title')}</Breadcrumbs.Link>
      <Breadcrumbs.Separator />
      <Breadcrumbs.Current>{tunnel.data?.name ?? '…'}</Breadcrumbs.Current>
    </Breadcrumbs>
  );

  if (tunnel.isLoading) return <div className="grid place-items-center py-24"><Loader size="lg" /></div>;
  if (!tunnel.data) return (<>{breadcrumbs}<div className="mt-6"><ErrorBanner error={tunnel.error} /></div></>);

  const d = tunnel.data;
  const ghost = d.managedHere && d.edgeStatus === 'down' && !d.createdAt;
  const running = d.local === 'active' || d.local === 'activating';

  const actions = d.managedHere ? (
    <>
      {running ? (
        <Button icon={<StopIcon />} loading={action.isPending && action.variables === 'stop'} onClick={() => run('stop', t('tunnel.stopped'))}>
          {t('tunnel.stop')}
        </Button>
      ) : (
        <Button variant="primary" icon={<PlayIcon />} loading={action.isPending && action.variables === 'start'} onClick={() => run('start', t('tunnel.started'))}>
          {t('tunnel.start')}
        </Button>
      )}
      <Button icon={<ArrowClockwiseIcon />} loading={action.isPending && action.variables === 'restart'} onClick={() => run('restart', t('tunnel.restarted'))}>
        {t('tunnel.restart')}
      </Button>
    </>
  ) : null;

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={d.name}
        badges={
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge kind="edge" value={d.edgeStatus} />
            <StatusBadge kind="local" value={d.local} />
            {d.managedHere && <StatusBadge kind="watchdog" value={d.watchdog} />}
            {multiAccount && d.account.name && <Badge variant="neutral">{d.account.name}</Badge>}
          </div>
        }
        actions={actions}
      />
      <div className="flex flex-col gap-4">
        {ghost && <Banner variant="error" description={t('tunnel.ghost')} />}
        {d.watchdog === 'failing' && <Banner variant="error" description={t('tunnel.failingBanner')} />}
        {!d.remote && <Banner variant="secondary" description={t('tunnel.localConfigBanner')} />}
        {d.remote && !d.managedHere && (
          <Banner
            description={t('tunnel.notHereBanner')}
            action={
              <Banner.Action loading={action.isPending && action.variables === 'adopt'} onClick={() => run('adopt', t('dashboard.adopted'))}>
                {t('dashboard.adopt')}
              </Banner.Action>
            }
          />
        )}
        <Tabs
          variant="underline"
          value={tab}
          onValueChange={(v) => setParams({ tab: String(v) }, { replace: true })}
          tabs={TABS.filter((x) => d.managedHere || x === 'routes' || x === 'status').map((x) => ({ value: x, label: t(`tunnel.tabs.${x}`) }))}
        />
        <div>
          {tab === 'routes' && <RoutesTab tunnel={d} onReload={() => void tunnel.refetch()} reloading={tunnel.isFetching} />}
          {tab === 'status' && <StatusTab tunnel={d} />}
          {tab === 'logs' && d.managedHere && <LogsTab tunnelId={d.id} />}
          {tab === 'events' && d.managedHere && <EventsTab tunnelId={d.id} />}
          {tab === 'settings' && d.managedHere && <SettingsTab tunnel={d} />}
        </div>
      </div>
    </>
  );
}
