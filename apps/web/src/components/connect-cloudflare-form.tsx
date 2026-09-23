import { Banner, Button, LinkButton, Select, SensitiveInput, Text } from '@cloudflare/kumo';
import { ArrowSquareOutIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { CloudflareStatus } from '@tm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { useConnectCloudflare } from '../api/hooks';
import { buildTokenTemplateUrl } from '../lib/token-link';
import { ErrorBanner } from './error-banner';

type Account = { id: string; name: string };

/** Token paste form shared by the setup wizard and the settings page. */
export function ConnectCloudflareForm({ onConnected }: { onConnected?: (s: CloudflareStatus) => void }) {
  const { t } = useTranslation();
  const connect = useConnectCloudflare();
  const [token, setToken] = useState('');
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [result, setResult] = useState<CloudflareStatus | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const status = await connect.mutateAsync({ token: token.trim(), ...(accountId ? { accountId } : {}) });
      setResult(status);
      onConnected?.(status);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_SELECTION_REQUIRED') {
        const list = (err.details as { accounts: Account[] }).accounts;
        setAccounts(list);
        setAccountId((prev) => prev ?? list[0]?.id);
      }
    }
  };

  if (result) {
    return (
      <Banner
        icon={<CheckCircleIcon />}
        title={t('setup.connected', { account: result.accountName })}
        description={t('setup.zonesFound', { count: result.zones.length })}
      />
    );
  }

  const selectionNeeded = connect.error instanceof ApiError && connect.error.code === 'ACCOUNT_SELECTION_REQUIRED';

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Text variant="secondary">{t('setup.tokenIntro')}</Text>
      <div className="flex flex-col gap-2 rounded-lg bg-kumo-recessed p-4">
        <Text bold size="sm">{t('setup.permissions')}</Text>
        <ul className="flex flex-col gap-1 font-mono text-sm text-kumo-strong">
          <li>{t('setup.permTunnel')}</li>
          <li>{t('setup.permDns')}</li>
          <li>{t('setup.permZone')}</li>
          <li>{t('setup.allZones')}</li>
        </ul>
      </div>
      <LinkButton href={buildTokenTemplateUrl()} target="_blank" rel="noreferrer" icon={<ArrowSquareOutIcon />} variant="secondary">
        {t('setup.createToken')}
      </LinkButton>
      <SensitiveInput label={t('setup.token')} value={token} onValueChange={setToken} autoComplete="off" />
      {accounts && (
        <Select
          className="w-full"
          label={t('setup.chooseAccount')}
          hideLabel={false}
          value={accountId}
          onValueChange={(v) => setAccountId(String(v))}
          items={Object.fromEntries(accounts.map((a) => [a.id, a.name]))}
        />
      )}
      {selectionNeeded ? (
        <Banner variant="default" description={t('errors.ACCOUNT_SELECTION_REQUIRED')} />
      ) : (
        <ErrorBanner error={connect.error} />
      )}
      <Button type="submit" variant="primary" loading={connect.isPending} disabled={token.trim().length < 20}>
        {t('setup.connect')}
      </Button>
    </form>
  );
}
