import { Badge, type BadgeVariant } from '@cloudflare/kumo';
import type { EdgeStatus, LocalState, WatchdogState } from '@tm/shared';
import { useTranslation } from 'react-i18next';

type Props = { kind: 'local'; value: LocalState } | { kind: 'edge'; value: EdgeStatus } | { kind: 'watchdog'; value: WatchdogState };

const TONE: Record<string, BadgeVariant> = {
  active: 'success', healthy: 'success',
  activating: 'warning', degraded: 'warning', restarting: 'warning',
  failed: 'error', down: 'error', failing: 'error',
  inactive: 'neutral', 'not-installed': 'outline', disabled: 'outline',
};

export function StatusBadge(p: Props) {
  const { t } = useTranslation();
  return (
    <Badge variant={TONE[p.value] ?? 'neutral'} appearance="dot">
      {t(`status.${p.kind}.${p.value}`)}
    </Badge>
  );
}
