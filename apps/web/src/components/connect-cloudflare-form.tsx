import { Banner, Button, LinkButton, SensitiveInput, Text } from '@cloudflare/kumo';
import { ArrowSquareOutIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { CloudflareStatus } from '@tm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectCloudflare } from '../api/hooks';
import { buildTokenTemplateUrl } from '../lib/token-link';
import { AccountsPicker } from './accounts-picker';
import { ErrorBanner } from './error-banner';

/** Token paste form shared by the setup wizard and the settings page. */
export function ConnectCloudflareForm({ onConnected }: { onConnected?: (s: CloudflareStatus) => void }) {
  const { t } = useTranslation();
  const connect = useConnectCloudflare();
  const [token, setToken] = useState('');
  const [result, setResult] = useState<CloudflareStatus | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const status = await connect.mutateAsync({ token: token.trim() }).catch(() => null);
    if (!status) return;
    setResult(status);
    onConnected?.(status);
  };

  if (result) {
    const banner = (
      <Banner
        icon={<CheckCircleIcon />}
        title={t('setup.connectedAccounts', { count: result.accounts.length })}
        description={t('setup.accountsSummary', {
          accounts: result.accounts.map((a) => a.name).join(', '),
          count: result.accounts.reduce((n, a) => n + a.zones.length, 0),
        })}
      />
    );
    if (result.accounts.length < 2) return banner;
    return (
      <div className="flex flex-col gap-4">
        {banner}
        <AccountsPicker accounts={result.accounts} />
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Text variant="secondary">{t('setup.tokenIntro')}</Text>
      <div className="flex flex-col gap-2 rounded-lg bg-kumo-recessed p-4">
        <Text bold size="sm">{t('setup.permissions')}</Text>
        <ul className="flex flex-col gap-1 font-mono text-sm text-kumo-strong">
          <li>{t('setup.permTunnel')}</li>
          <li>{t('setup.permDns')}</li>
          <li>{t('setup.permZone')}</li>
          <li>{t('setup.permAccount')}</li>
          <li>{t('setup.allZones')}</li>
        </ul>
      </div>
      <LinkButton href={buildTokenTemplateUrl()} target="_blank" rel="noreferrer" icon={<ArrowSquareOutIcon />} variant="secondary">
        {t('setup.createToken')}
      </LinkButton>
      <SensitiveInput label={t('setup.token')} value={token} onValueChange={setToken} autoComplete="off" />
      <ErrorBanner error={connect.error} />
      <Button type="submit" variant="primary" loading={connect.isPending} disabled={token.trim().length < 20}>
        {t('setup.connect')}
      </Button>
    </form>
  );
}
