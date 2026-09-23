import { Button, Dialog, Input, LayerCard, Select, Switch, Text, Toast } from '@cloudflare/kumo';
import { WarningIcon } from '@phosphor-icons/react';
import { createTunnelSchema, type LogLevel, type Protocol, type TunnelDetail, type UpdateTunnel } from '@tm/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useDeleteTunnel, useErrorMessage, useUpdateTunnel } from '../../api/hooks';
import { ErrorBanner } from '../error-banner';

function DeleteTunnelDialog({ tunnel, open, onOpenChange }: { tunnel: TunnelDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const del = useDeleteTunnel();
  const toasts = Toast.useToastManager();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog className="p-6" size="base">
        <div className="flex flex-col gap-4">
          <Dialog.Title className="text-xl font-semibold">{t('tunnel.deleteTitle', { name: tunnel.name })}</Dialog.Title>
          <Dialog.Description className="text-kumo-subtle">{t('tunnel.deleteDescription')}</Dialog.Description>
          <Input label={t('tunnel.deleteConfirm', { name: tunnel.name })} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <ErrorBanner error={del.error} />
          <div className="flex justify-end gap-2">
            <Dialog.Close render={(p) => <Button {...p}>{t('common.cancel')}</Button>} />
            <Button
              variant="destructive"
              disabled={typed !== tunnel.name}
              loading={del.isPending}
              onClick={() =>
                del.mutate(tunnel.id, {
                  onSuccess: () => {
                    toasts.add({ title: t('tunnel.deleted') });
                    onOpenChange(false);
                    nav('/');
                  },
                })
              }
            >
              {t('tunnel.deleteButton')}
            </Button>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

export function SettingsTab({ tunnel }: { tunnel: TunnelDetail }) {
  const { t } = useTranslation();
  const update = useUpdateTunnel(tunnel.id);
  const toasts = Toast.useToastManager();
  const msg = useErrorMessage();
  const s = tunnel.settings!;
  const [name, setName] = useState(tunnel.name);
  const [keepAlive, setKeepAlive] = useState(s.keepAlive);
  const [tolerance, setTolerance] = useState(String(s.toleranceMinutes));
  const [logLevel, setLogLevel] = useState<LogLevel>(s.logLevel);
  const [protocol, setProtocol] = useState<Protocol>(s.protocol);
  const [deleting, setDeleting] = useState(false);

  const tol = Number(tolerance);
  const tolValid = Number.isInteger(tol) && tol >= 1 && tol <= 60;
  const nameValid = createTunnelSchema.safeParse({ name }).success;

  const patch: UpdateTunnel = {
    ...(name !== tunnel.name ? { name } : {}),
    ...(keepAlive !== s.keepAlive ? { keepAlive } : {}),
    ...(tolValid && tol !== s.toleranceMinutes ? { toleranceMinutes: tol } : {}),
    ...(logLevel !== s.logLevel ? { logLevel } : {}),
    ...(protocol !== s.protocol ? { protocol } : {}),
  };
  const dirty = Object.keys(patch).length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !tolValid || !nameValid) return;
    update.mutate(patch, {
      onSuccess: () => toasts.add({ title: t('common.saved') }),
      onError: (err) => toasts.add({ title: msg(err), type: 'error' }),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <LayerCard>
        <LayerCard.Secondary>{t('tunnel.general')}</LayerCard.Secondary>
        <LayerCard.Primary>
          <form className="flex max-w-xl flex-col gap-5 p-1" onSubmit={submit}>
            <Input label={t('tunnel.rename')} value={name} onChange={(e) => setName(e.target.value)} variant={nameValid ? 'default' : 'error'} />
            <Switch label={t('tunnel.keepAlive')} checked={keepAlive} onCheckedChange={setKeepAlive} />
            <Text variant="secondary" size="sm">{t('tunnel.keepAliveHint')}</Text>
            <Input
              label={t('tunnel.tolerance')}
              description={t('tunnel.toleranceHint')}
              type="number"
              min={1}
              max={60}
              value={tolerance}
              disabled={!keepAlive}
              onChange={(e) => setTolerance(e.target.value)}
              variant={tolValid ? 'default' : 'error'}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t('tunnel.logLevel')}
                hideLabel={false}
                value={logLevel}
                onValueChange={(v) => setLogLevel(v as LogLevel)}
                items={{ debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'fatal' }}
              />
              <Select
                label={t('tunnel.protocol')}
                hideLabel={false}
                value={protocol}
                onValueChange={(v) => setProtocol(v as Protocol)}
                items={{ auto: 'auto', quic: 'QUIC', http2: 'HTTP/2' }}
              />
            </div>
            <div>
              <Button type="submit" variant="primary" disabled={!dirty || !tolValid || !nameValid} loading={update.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </LayerCard.Primary>
      </LayerCard>

      <LayerCard className="ring-kumo-danger/40">
        <LayerCard.Secondary>
          <span className="flex items-center gap-2 text-kumo-danger"><WarningIcon /> {t('tunnel.dangerZone')}</span>
        </LayerCard.Secondary>
        <LayerCard.Primary>
          <div className="flex flex-wrap items-center justify-between gap-4 p-1">
            <Text variant="secondary">{t('tunnel.dangerHint')}</Text>
            <Button variant="destructive" onClick={() => setDeleting(true)}>{t('tunnel.deleteButton')}</Button>
          </div>
        </LayerCard.Primary>
      </LayerCard>

      <DeleteTunnelDialog tunnel={tunnel} open={deleting} onOpenChange={setDeleting} />
    </div>
  );
}
