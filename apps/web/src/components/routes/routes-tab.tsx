import { Banner, Button, Checkbox, Dialog, Empty, LayerCard, Table, Text, Toast } from '@cloudflare/kumo';
import { ArrowDownIcon, ArrowUpIcon, GlobeIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import type { Route, TunnelDetail } from '@tm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { useCloudflareStatus, useErrorMessage, useSaveRoutes } from '../../api/hooks';
import { ErrorBanner } from '../error-banner';
import { RouteFormDialog } from './route-form-dialog';
import { moveRoute } from './route-model';

type Pending = { routes: Route[]; keepDns?: string[] };
/** What a dialog was opened on; saves are built from it so a background refresh cannot shift indexes. */
type Snapshot = { version: number; routes: Route[] };

export function RoutesTab({ tunnel, onReload, reloading = false }: { tunnel: TunnelDetail; onReload?: () => void; reloading?: boolean }) {
  const { t } = useTranslation();
  // A tunnel only serves hostnames of zones in its own account.
  const zones = useCloudflareStatus().data?.accounts.find((a) => a.id === tunnel.account.id)?.zones ?? [];
  const save = useSaveRoutes(tunnel.id);
  const toasts = Toast.useToastManager();
  const msg = useErrorMessage();
  const editable = tunnel.managedHere && tunnel.remote;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [conflict, setConflict] = useState<{ base: Snapshot; pending: Pending; hostnames: string[] } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [removeDns, setRemoveDns] = useState(true);
  const [error, setError] = useState<unknown>(null);
  /** Which move button started the save in progress, so only that one spins. */
  const [moving, setMoving] = useState<string | null>(null);
  const move = (i: number, by: -1 | 1) => {
    setMoving(`${i}:${by}`);
    void persist(current(), { routes: moveRoute(tunnel.routes, i, by) }).finally(() => setMoving(null));
  };
  const [snapshot, setSnapshot] = useState<Snapshot>({ version: tunnel.configVersion, routes: tunnel.routes });
  const current = (): Snapshot => ({ version: tunnel.configVersion, routes: tunnel.routes });
  const openWith = (open: () => void) => {
    setSnapshot(current());
    open();
  };

  const persist = async (base: Snapshot, pending: Pending, overwriteDns: string[] = []) => {
    setError(null);
    try {
      await save.mutateAsync({ version: base.version, routes: pending.routes, overwriteDns, keepDns: pending.keepDns ?? [] });
      toasts.add({ title: t('routes.saved') });
      setFormOpen(false);
      setConflict(null);
      setRemoving(null);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DNS_CONFLICT') {
        // Swap the form for the confirmation so the prompt is never stacked under it.
        setFormOpen(false);
        setRemoving(null);
        setConflict({ base, pending, hostnames: (e.details as { hostnames: string[] }).hostnames });
      } else {
        setError(e);
        if (!(e instanceof ApiError && e.code === 'CONFIG_VERSION_CONFLICT')) toasts.add({ title: msg(e), type: 'error' });
      }
      return false;
    }
  };

  const onSubmitRoute = (route: Route) => {
    const routes = [...snapshot.routes];
    if (editing === null) routes.push(route);
    else routes[editing] = route;
    void persist(snapshot, { routes });
  };

  const removeRoute = (index: number) => {
    const target = snapshot.routes[index]!;
    const routes = snapshot.routes.filter((_, i) => i !== index);
    const stillUsed = routes.some((r) => r.hostname === target.hostname);
    void persist(snapshot, { routes, keepDns: !stillUsed && !removeDns ? [target.hostname] : [] });
  };

  const removingRoute = removing !== null ? snapshot.routes[removing] : null;
  const removingShared = removingRoute ? snapshot.routes.filter((r) => r.hostname === removingRoute.hostname).length > 1 : false;
  const versionConflict = error instanceof ApiError && error.code === 'CONFIG_VERSION_CONFLICT';

  return (
    <div className="flex flex-col gap-4">
      {versionConflict ? (
        <Banner
          variant="alert"
          description={t('errors.CONFIG_VERSION_CONFLICT')}
          action={<Banner.Action loading={reloading} onClick={() => { setError(null); onReload?.(); }}>{t('routes.reload')}</Banner.Action>}
        />
      ) : (
        <ErrorBanner error={error} />
      )}

      {editable && (
        <div className="flex justify-end">
          <Button variant="primary" icon={<PlusIcon />} onClick={() => openWith(() => { setEditing(null); setFormOpen(true); })}>
            {t('routes.add')}
          </Button>
        </div>
      )}

      {tunnel.routes.length === 0 ? (
        <LayerCard>
          <LayerCard.Primary>
            <Empty icon={<GlobeIcon size={48} />} title={t('routes.empty')} description={t('routes.emptyHint')} />
          </LayerCard.Primary>
        </LayerCard>
      ) : (
        <LayerCard className="overflow-x-auto p-0">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>{t('routes.hostname')}</Table.Head>
                <Table.Head>{t('routes.service')}</Table.Head>
                {editable && <Table.Head className="w-40 text-right">{t('common.actions')}</Table.Head>}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {tunnel.routes.map((r, i) => (
                <Table.Row key={`${r.hostname}-${r.path ?? ''}-${i}`}>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <a className="text-kumo-link hover:underline" href={`https://${r.hostname.replace(/^\*\./, '')}`} target="_blank" rel="noreferrer">
                        {r.hostname}
                      </a>
                      {r.path && <Text variant="mono-secondary">{r.path}</Text>}
                    </div>
                  </Table.Cell>
                  <Table.Cell><Text variant="mono">{r.service}</Text></Table.Cell>
                  {editable && (
                    <Table.Cell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" shape="square" icon={<ArrowUpIcon />} aria-label={t('routes.moveUp')}
                          loading={moving === `${i}:-1`} disabled={i === 0 || save.isPending} onClick={() => move(i, -1)} />
                        <Button size="sm" variant="ghost" shape="square" icon={<ArrowDownIcon />} aria-label={t('routes.moveDown')}
                          loading={moving === `${i}:1`} disabled={i === tunnel.routes.length - 1 || save.isPending} onClick={() => move(i, 1)} />
                        <Button size="sm" variant="ghost" shape="square" icon={<PencilSimpleIcon />} aria-label={t('common.edit')}
                          onClick={() => openWith(() => { setEditing(i); setFormOpen(true); })} />
                        <Button size="sm" variant="ghost" shape="square" icon={<TrashIcon />} aria-label={t('routes.removeTitle', { hostname: r.hostname })}
                          onClick={() => openWith(() => { setRemoveDns(true); setRemoving(i); })} />
                      </div>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
              <Table.Row className="bg-kumo-tint">
                <Table.Cell><Text variant="secondary">*</Text></Table.Cell>
                <Table.Cell>
                  <Text variant="secondary">
                    <span className="font-mono">http_status:404</span> — {t('routes.catchAll')}
                  </Text>
                </Table.Cell>
                {editable && <Table.Cell />}
              </Table.Row>
            </Table.Body>
          </Table>
        </LayerCard>
      )}

      <RouteFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        zones={zones}
        initial={editing !== null ? (snapshot.routes[editing] ?? null) : null}
        saving={save.isPending}
        onSubmit={onSubmitRoute}
      />

      <Dialog.Root open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <Dialog className="p-6" size="base">
          <div className="flex flex-col gap-4">
            <Dialog.Title className="text-xl font-semibold">{t('routes.conflictTitle')}</Dialog.Title>
            <Dialog.Description className="text-kumo-subtle">
              {t('routes.conflictDescription', { hostnames: conflict?.hostnames.join(', ') })}
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Dialog.Close render={(p) => <Button {...p}>{t('common.cancel')}</Button>} />
              <Button variant="destructive" loading={save.isPending} onClick={() => conflict && void persist(conflict.base, conflict.pending, conflict.hostnames)}>
                {t('routes.overwrite')}
              </Button>
            </div>
          </div>
        </Dialog>
      </Dialog.Root>

      <Dialog.Root open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <Dialog className="p-6" size="base">
          <div className="flex flex-col gap-4">
            <Dialog.Title className="text-xl font-semibold">{t('routes.removeTitle', { hostname: removingRoute?.hostname })}</Dialog.Title>
            <Dialog.Description className="text-kumo-subtle">{t('routes.removeDescription')}</Dialog.Description>
            {!removingShared && <Checkbox label={t('routes.removeDns')} checked={removeDns} onCheckedChange={(c) => setRemoveDns(!!c)} />}
            <div className="flex justify-end gap-2">
              <Dialog.Close render={(p) => <Button {...p}>{t('common.cancel')}</Button>} />
              <Button variant="destructive" loading={save.isPending} onClick={() => removing !== null && removeRoute(removing)}>
                {t('routes.remove')}
              </Button>
            </div>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  );
}
