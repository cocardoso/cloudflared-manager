import { Banner, Button, Checkbox, Collapsible, Dialog, Input, Select, Text } from '@cloudflare/kumo';
import { PlugsConnectedIcon } from '@phosphor-icons/react';
import type { Route, Zone } from '@tm/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useTestOrigin } from '../../api/hooks';
import { emptyForm, formToRoute, hostnameOf, routeToForm, SERVICE_TYPES, type RouteFormValues } from './route-model';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  zones: Zone[];
  initial: Route | null;
  saving: boolean;
  onSubmit: (route: Route) => void;
}

const TYPE_LABELS: Record<string, string> = {
  http: 'HTTP', https: 'HTTPS', tcp: 'TCP', ssh: 'SSH', rdp: 'RDP', unix: 'Unix socket', http_status: 'HTTP status',
};

export function RouteFormDialog({ open, onOpenChange, zones, initial, saving, onSubmit }: Props) {
  const { t } = useTranslation();
  const testOrigin = useTestOrigin();
  const [v, setV] = useState<RouteFormValues>(emptyForm(zones[0]?.name));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!open) return;
    setV(initial ? routeToForm(initial, zones) : emptyForm(zones[0]?.name));
    setInvalid(false);
    testOrigin.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const set = <K extends keyof RouteFormValues>(k: K, value: RouteFormValues[K]) => setV((prev) => ({ ...prev, [k]: value }));

  const build = () => {
    try {
      return formToRoute(v, initial);
    } catch {
      return null;
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const route = build();
    setInvalid(!route);
    if (route) onSubmit(route);
  };

  const route = build();
  const isHttp = v.type === 'http' || v.type === 'https';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="lg" className="p-6">
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <Dialog.Title className="text-xl font-semibold">{initial ? t('routes.editTitle') : t('routes.addTitle')}</Dialog.Title>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <Input label={t('routes.subdomain')} value={v.subdomain} onChange={(e) => set('subdomain', e.target.value)} placeholder="app" autoFocus />
            <Select
              className="w-full"
              label={t('routes.domain')}
              hideLabel={false}
              value={v.zone}
              onValueChange={(x) => set('zone', String(x))}
              items={Object.fromEntries(zones.map((z) => [z.name, z.name]))}
            />
          </div>
          <Input
            label={t('routes.path')}
            description={t('common.optional')}
            value={v.path}
            onChange={(e) => set('path', e.target.value)}
            placeholder={t('routes.pathPlaceholder')}
          />
          {v.zone && (
            <Text variant="secondary" size="sm">
              {t('routes.preview')}: <span className="font-mono text-kumo-default">https://{hostnameOf(v)}{v.path ? v.path.replace(/^\^/, '') : ''}</span>
            </Text>
          )}

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Select
              className="w-full"
              label={t('routes.type')}
              hideLabel={false}
              value={v.type}
              onValueChange={(x) => set('type', x as RouteFormValues['type'])}
              items={Object.fromEntries(SERVICE_TYPES.map((s) => [s, TYPE_LABELS[s]]))}
            />
            <Input
              label={t('routes.url')}
              value={v.target}
              onChange={(e) => set('target', e.target.value)}
              placeholder={v.type === 'unix' ? '/run/app.sock' : v.type === 'http_status' ? '404' : t('routes.urlPlaceholder')}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              icon={<PlugsConnectedIcon />}
              disabled={!route}
              loading={testOrigin.isPending}
              onClick={() => route && testOrigin.mutate(route.service)}
            >
              {t('routes.testOrigin')}
            </Button>
            {testOrigin.data && (
              <Text size="sm" variant={testOrigin.data.reachable ? 'success' : 'error'}>
                {testOrigin.data.reachable
                  ? t('routes.reachable', { ms: testOrigin.data.latencyMs })
                  : t('routes.unreachable', { error: testOrigin.data.error })}
              </Text>
            )}
          </div>

          {isHttp && (
            <Collapsible.Root>
              <Collapsible.DefaultTrigger>{t('common.advanced')}</Collapsible.DefaultTrigger>
              <Collapsible.DefaultPanel>
                <div className="flex flex-col gap-3 pt-2">
                  <Checkbox label={t('routes.noTLSVerify')} checked={v.noTLSVerify} onCheckedChange={(c) => set('noTLSVerify', !!c)} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label={t('routes.httpHostHeader')} value={v.httpHostHeader} onChange={(e) => set('httpHostHeader', e.target.value)} />
                    <Input label={t('routes.originServerName')} value={v.originServerName} onChange={(e) => set('originServerName', e.target.value)} />
                    <Input label={t('routes.connectTimeout')} description={t('routes.durationHint')} type="number" min={1} value={v.connectTimeout} onChange={(e) => set('connectTimeout', e.target.value)} />
                    <Input label={t('routes.keepAliveTimeout')} description={t('routes.durationHint')} type="number" min={1} value={v.keepAliveTimeout} onChange={(e) => set('keepAliveTimeout', e.target.value)} />
                  </div>
                </div>
              </Collapsible.DefaultPanel>
            </Collapsible.Root>
          )}

          {invalid && <Banner variant="error" description={t('routes.invalid')} />}

          <div className="flex justify-end gap-2">
            <Dialog.Close render={(p) => <Button {...p} type="button">{t('common.cancel')}</Button>} />
            <Button type="submit" variant="primary" loading={saving}>{t('common.save')}</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  );
}
