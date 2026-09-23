import { Banner, Button, Dialog, Input, Select } from '@cloudflare/kumo';
import { createTunnelSchema } from '@tm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCloudflareStatus, useCreateTunnel } from '../api/hooks';
import { ErrorBanner } from './error-banner';

export function CreateTunnelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const create = useCreateTunnel();
  const cf = useCloudflareStatus().data;
  const accounts = cf?.accounts ?? [];
  const multi = accounts.length > 1;
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  // Start from the account used last; fall back to the first one.
  const accountId = picked ?? (accounts.some((a) => a.id === cf?.lastAccountId) ? cf!.lastAccountId! : accounts[0]?.id);
  const valid = createTunnelSchema.safeParse({ name }).success;
  // Without the account list the server could not tell where to create the tunnel.
  const accountsMissing = !!cf && accounts.length === 0;
  const ready = valid && !!accountId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const tunnel = await create.mutateAsync({ name: name.trim(), accountId }).catch(() => null);
    if (!tunnel) return;
    onOpenChange(false);
    setName('');
    setPicked(null);
    nav(`/tunnels/${tunnel.id}?tab=routes`);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog className="p-6" size="base">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Dialog.Title className="text-xl font-semibold">{t('dashboard.createTitle')}</Dialog.Title>
          {multi && (
            <Select
              className="w-full"
              label={t('dashboard.account')}
              description={t('dashboard.createAccountHint')}
              value={accountId}
              onValueChange={(v) => setPicked(String(v))}
              items={Object.fromEntries(accounts.map((a) => [a.id, a.name]))}
            />
          )}
          <Input
            label={t('dashboard.createName')}
            description={t('dashboard.createNameHint')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="homelab"
            autoFocus
            variant={name && !valid ? 'error' : 'default'}
          />
          {accountsMissing && <Banner variant="error" description={t('dashboard.accountsMissing')} />}
          <ErrorBanner error={create.error} />
          <div className="flex justify-end gap-2">
            <Dialog.Close render={(p) => <Button {...p} variant="secondary">{t('common.cancel')}</Button>} />
            <Button type="submit" variant="primary" disabled={!ready} loading={create.isPending}>
              {t('common.create')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  );
}
