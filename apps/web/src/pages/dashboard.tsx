import { Banner, Button, Empty, Input, LayerCard, Loader, Text } from '@cloudflare/kumo';
import { ArrowCircleUpIcon, PlusIcon, TreeStructureIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCloudflaredInfo, useRecentEvents, useTunnels } from '../api/hooks';
import { CreateTunnelDialog } from '../components/create-tunnel-dialog';
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

  const list = tunnels.data ?? [];
  const filtered = useMemo(() => list.filter((x) => x.name.toLowerCase().includes(query.trim().toLowerCase())), [list, query]);
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
            action={<Banner.Action onClick={() => nav('/settings')}>{t('dashboard.updateAction')}</Banner.Action>}
          />
        )}
        <ErrorBanner error={tunnels.error} />
        {tunnels.isLoading ? (
          <div className="grid place-items-center py-16"><Loader size="lg" /></div>
        ) : list.length === 0 && !tunnels.error ? (
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
            <SummaryCards tunnels={list} />
            <Input
              aria-label={t('dashboard.search')}
              placeholder={t('dashboard.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full"
            />
            <LayerCard className="p-0">
              {filtered.length ? (
                <TunnelTable tunnels={filtered} />
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
