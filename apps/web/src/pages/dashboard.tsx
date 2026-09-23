import { Banner, Button, Empty, Input, LayerCard, Loader, Select, Text } from '@cloudflare/kumo';
import { ArrowCircleUpIcon, PlusIcon, TreeStructureIcon, WarningIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCloudflareStatus, useCloudflaredInfo, useRecentEvents, useTunnels } from '../api/hooks';
import { CreateTunnelDialog } from '../components/create-tunnel-dialog';
import { activeAccounts } from '../lib/accounts';
import { ErrorBanner } from '../components/error-banner';
import { EventList } from '../components/event-list';
import { PageHeader } from '../components/page-header';
import { SummaryCards } from '../components/summary-cards';
import { TunnelTable } from '../components/tunnel-table';

export function DashboardPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const tunnels = useTunnels();
  const events = useRecentEvents();
  const info = useCloudflaredInfo();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const accounts = activeAccounts(useCloudflareStatus().data);
  const multi = accounts.length > 1;
  // An account turned off (or gone) since it was picked falls back to all accounts.
  const filter = accounts.some((a) => a.id === accountFilter) ? accountFilter : 'all';

  const list = useMemo(() => tunnels.data?.tunnels ?? [], [tunnels.data]);
  const unavailable = tunnels.data?.unavailableAccounts ?? [];
  // The account filter drives the cards too; the name search only narrows the table.
  const inAccount = useMemo(
    () => (multi && filter !== 'all' ? list.filter((x) => x.account.id === filter) : list),
    [list, multi, filter],
  );
  const filtered = useMemo(() => inAccount.filter((x) => x.name.toLowerCase().includes(query.trim().toLowerCase())), [inAccount, query]);
  const names = useMemo(() => Object.fromEntries(list.map((x) => [x.id, x.name])), [list]);
  const createButton = (
    <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
      {t('dashboard.create')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><TreeStructureIcon /> {t('dashboard.title')}</span>}
        description={t('dashboard.subtitle')}
        actions={createButton}
      />
      <div className="flex flex-col gap-6">
        {info.data?.updateAvailable && (
          <Banner
            variant="alert"
            icon={<ArrowCircleUpIcon />}
            description={t('dashboard.updateAvailable', { latest: info.data.latest, installed: info.data.installed })}
            action={
              <Banner.Action onClick={() => nav('/settings')}>
                {info.data.canSelfUpdate ? t('dashboard.updateAction') : t('dashboard.updateActionImage')}
              </Banner.Action>
            }
          />
        )}
        <ErrorBanner error={tunnels.error} />
        {unavailable.map((a) => (
          <Banner
            key={a.id}
            variant="alert"
            icon={<WarningIcon />}
            description={t('dashboard.accountUnavailable', {
              account: a.name,
              reason: t(`errors.${a.code}`, { permission: 'Account: Cloudflare Tunnel: Edit' }),
            })}
          />
        ))}
        {tunnels.isLoading ? (
          <div className="grid place-items-center py-16"><Loader size="lg" /></div>
        ) : list.length === 0 && !tunnels.error && unavailable.length === 0 ? (
          <LayerCard>
            <LayerCard.Primary>
              <Empty
                icon={<TreeStructureIcon size={48} />}
                title={t('dashboard.emptyTitle')}
                description={t('dashboard.emptyDescription')}
                contents={createButton}
              />
            </LayerCard.Primary>
          </LayerCard>
        ) : (
          <>
            <SummaryCards tunnels={inAccount} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              {multi && (
                <Select
                  className="sm:w-56"
                  label={t('dashboard.account')}
                  value={filter}
                  onValueChange={(v) => setAccountFilter(String(v))}
                  items={{ all: t('dashboard.allAccounts'), ...Object.fromEntries(accounts.map((a) => [a.id, a.name])) }}
                />
              )}
              <div className="grow">
                <Input
                  aria-label={t('dashboard.search')}
                  placeholder={t('dashboard.search')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
            <LayerCard className="overflow-x-auto p-0">
              {filtered.length ? (
                <TunnelTable tunnels={filtered} showAccount={multi} />
              ) : (
                <div className="p-6"><Text variant="secondary">{t('dashboard.noMatch')}</Text></div>
              )}
            </LayerCard>
          </>
        )}
        <LayerCard>
          <LayerCard.Secondary>{t('dashboard.recentEvents')}</LayerCard.Secondary>
          <LayerCard.Primary>
            <EventList events={events.data ?? []} names={names} />
          </LayerCard.Primary>
        </LayerCard>
      </div>
      <CreateTunnelDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
