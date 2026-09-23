import { Banner } from '@cloudflare/kumo';
import { WarningCircleIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useErrorMessage } from '../api/hooks';

export function ErrorBanner({ error, action }: { error: unknown; action?: ReactNode }) {
  const msg = useErrorMessage();
  if (!error) return null;
  return <Banner variant="error" icon={<WarningCircleIcon />} description={msg(error)} action={action} />;
}
