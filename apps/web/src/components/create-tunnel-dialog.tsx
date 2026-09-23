import { Button, Dialog, Input } from '@cloudflare/kumo';
import { createTunnelSchema } from '@tm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCreateTunnel } from '../api/hooks';
import { ErrorBanner } from './error-banner';

export function CreateTunnelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const create = useCreateTunnel();
  const [name, setName] = useState('');
  const valid = createTunnelSchema.safeParse({ name }).success;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const tunnel = await create.mutateAsync(name.trim()).catch(() => null);
    if (!tunnel) return;
    onOpenChange(false);
    setName('');
    nav(`/tunnels/${tunnel.id}?tab=routes`);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog className="p-6" size="base">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Dialog.Title className="text-xl font-semibold">{t('dashboard.createTitle')}</Dialog.Title>
          <Input
            label={t('dashboard.createName')}
            description={t('dashboard.createNameHint')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="homelab"
            autoFocus
            variant={name && !valid ? 'error' : 'default'}
          />
          <ErrorBanner error={create.error} />
          <div className="flex justify-end gap-2">
            <Dialog.Close render={(p) => <Button {...p} variant="secondary">{t('common.cancel')}</Button>} />
            <Button type="submit" variant="primary" disabled={!valid} loading={create.isPending}>
              {t('common.create')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  );
}
