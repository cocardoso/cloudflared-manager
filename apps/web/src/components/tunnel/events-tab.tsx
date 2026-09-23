import { LayerCard, Loader } from '@cloudflare/kumo';
import { useTunnelEvents } from '../../api/hooks';
import { ErrorBanner } from '../error-banner';
import { EventList } from '../event-list';

export function EventsTab({ tunnelId }: { tunnelId: string }) {
  const events = useTunnelEvents(tunnelId);
  return (
    <LayerCard>
      <LayerCard.Primary>
        {events.isLoading ? <Loader /> : <EventList events={events.data ?? []} />}
        <ErrorBanner error={events.error} />
      </LayerCard.Primary>
    </LayerCard>
  );
}
