import { Badge, Button, Dialog, LayerCard, Select, SensitiveInput, Text, Toast } from '@cloudflare/kumo';
import { DownloadSimpleIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useChangePassword, useCloudflareStatus, useCloudflaredInfo, useErrorMessage, useUpdateCloudflared } from '../api/hooks';
import { ConnectCloudflareForm } from '../components/connect-cloudflare-form';
import { ErrorBanner } from '../components/error-banner';
import { PageHeader } from '../components/page-header';
import { LANGUAGES, setLanguage } from '../i18n';
import { applyTheme, getStoredTheme, type Theme } from '../lib/theme';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <LayerCard>
      <LayerCard.Secondary>{title}</LayerCard.Secondary>
      <LayerCard.Primary><div className="flex flex-col gap-4 p-1">{children}</div></LayerCard.Primary>
    </LayerCard>
  );
}

function AccountSection() {
  const { t } = useTranslation();
  const cf = useCloudflareStatus();
  const [replacing, setReplacing] = useState(false);
  const d = cf.data;
  return (
    <Section title={t('settings.account')}>
      <ErrorBanner error={cf.error} />
      {d && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Text variant="secondary" size="sm">{t('settings.tokenEnding', { suffix: d.tokenSuffix })}</Text>
          <Button onClick={() => setReplacing(true)}>{t('settings.replaceToken')}</Button>
        </div>
      )}
      {d?.accounts.map((a) => (
        <div key={a.id} data-account={a.id} className="flex flex-col gap-2">
          <Text bold>{a.name}</Text>
          {a.zones.length ? (
            <div className="flex flex-wrap gap-1.5">
              {a.zones.map((z) => <Badge key={z.id} variant="neutral">{z.name}</Badge>)}
            </div>
          ) : (
            <Text variant="secondary" size="sm">{t('settings.noDomains')}</Text>
          )}
        </div>
      ))}
      <Dialog.Root open={replacing} onOpenChange={setReplacing}>
        <Dialog className="p-6" size="lg">
          <div className="flex flex-col gap-4">
            <Dialog.Title className="text-xl font-semibold">{t('settings.replaceToken')}</Dialog.Title>
            <ConnectCloudflareForm />
            <div className="flex justify-end">
              <Dialog.Close render={(p) => <Button {...p}>{t('common.close')}</Button>} />
            </div>
          </div>
        </Dialog>
      </Dialog.Root>
    </Section>
  );
}

function PasswordSection() {
  const { t } = useTranslation();
  const change = useChangePassword();
  const toasts = Toast.useToastManager();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const valid = current.length > 0 && next.length >= 12;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          toasts.add({ title: t('settings.passwordChanged') });
        },
      },
    );
  };

  return (
    <Section title={t('settings.password')}>
      <form className="flex max-w-md flex-col gap-4" onSubmit={submit}>
        <SensitiveInput label={t('settings.currentPassword')} value={current} onValueChange={setCurrent} autoComplete="current-password" />
        <SensitiveInput
          label={t('settings.newPassword')}
          description={t('setup.passwordHint')}
          value={next}
          onValueChange={setNext}
          autoComplete="new-password"
        />
        <ErrorBanner error={change.error} />
        <div>
          <Button type="submit" variant="primary" disabled={!valid} loading={change.isPending}>{t('settings.changePassword')}</Button>
        </div>
      </form>
    </Section>
  );
}

function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  return (
    <Section title={t('settings.appearance')}>
      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <Select
          className="w-full"
          label={t('nav.language')}
          value={i18n.resolvedLanguage ?? 'en'}
          onValueChange={(v) => void setLanguage(String(v))}
          items={Object.fromEntries(LANGUAGES.map((l) => [l.value, l.label]))}
        />
        <Select
          className="w-full"
          label={t('settings.theme')}
          value={theme}
          onValueChange={(v) => {
            setTheme(v as Theme);
            applyTheme(v as Theme);
          }}
          items={{ system: t('settings.themeSystem'), light: t('settings.themeLight'), dark: t('settings.themeDark') }}
        />
      </div>
    </Section>
  );
}

function CloudflaredSection() {
  const { t } = useTranslation();
  const info = useCloudflaredInfo();
  const update = useUpdateCloudflared();
  const toasts = Toast.useToastManager();
  const msg = useErrorMessage();
  const d = info.data;
  return (
    <Section title={t('settings.cloudflared')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-kumo-subtle">{t('settings.installed')}</dt>
          <dd className="font-mono">{d?.installed ?? '—'}</dd>
          <dt className="text-kumo-subtle">{t('settings.latest')}</dt>
          <dd className="font-mono">{d?.latest ?? '—'}</dd>
        </dl>
        {d && !d.canSelfUpdate ? (
          <Text variant="secondary" size="sm">{t('settings.imageUpdateHint')}</Text>
        ) : d?.updateAvailable ? (
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() =>
              update.mutate(undefined, {
                onSuccess: () => toasts.add({ title: t('settings.updated') }),
                onError: (e) => toasts.add({ title: msg(e), type: 'error' }),
              })
            }
          >
            {t('settings.update')}
          </Button>
        ) : (
          d && <Badge variant="success" appearance="dot">{t('settings.upToDate')}</Badge>
        )}
      </div>
    </Section>
  );
}

function BackupSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toasts = Toast.useToastManager();
  const msg = useErrorMessage();
  const file = useRef<HTMLInputElement>(null);

  const exportBackup = async () => {
    const data = await api.get<unknown>('/backup');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cloudflared-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (f: File) => {
    try {
      await api.post('/backup', JSON.parse(await f.text()));
      await qc.invalidateQueries();
      toasts.add({ title: t('settings.imported') });
    } catch (e) {
      toasts.add({ title: msg(e), type: 'error' });
    }
  };

  return (
    <Section title={t('settings.backup')}>
      <Text variant="secondary">{t('settings.backupHint')}</Text>
      <div className="flex flex-wrap gap-2">
        <Button icon={<DownloadSimpleIcon />} onClick={() => void exportBackup()}>{t('settings.export')}</Button>
        <Button icon={<UploadSimpleIcon />} onClick={() => file.current?.click()}>{t('settings.import')}</Button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importBackup(f);
            e.target.value = '';
          }}
        />
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      <div className="flex flex-col gap-6">
        <AccountSection />
        <CloudflaredSection />
        <PasswordSection />
        <AppearanceSection />
        <BackupSection />
      </div>
    </>
  );
}
