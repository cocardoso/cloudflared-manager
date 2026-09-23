import { Button, Checkbox, Text, Toast } from '@cloudflare/kumo';
import type { CloudflareAccount } from '@tm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSaveAccounts } from '../api/hooks';
import { ErrorBanner } from './error-banner';

/** One checkbox per account the token reaches; the checked ones become the active accounts. */
export function AccountsPicker({ accounts }: { accounts: CloudflareAccount[] }) {
  const { t } = useTranslation();
  const save = useSaveAccounts();
  const toasts = Toast.useToastManager();
  const [selected, setSelected] = useState(() => new Set(accounts.filter((a) => a.enabled).map((a) => a.id)));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <Text variant="secondary" size="sm">{t('accounts.hint')}</Text>
      <div className="flex flex-col gap-3">
        {accounts.map((a) => (
          <div key={a.id} data-account={a.id} className="flex flex-col gap-1">
            <Checkbox label={a.name} checked={selected.has(a.id)} onCheckedChange={(c) => toggle(a.id, !!c)} />
            <Text variant="secondary" size="sm">
              {a.zones.length ? a.zones.map((z) => z.name).join(', ') : t('settings.noDomains')}
            </Text>
          </div>
        ))}
      </div>
      <ErrorBanner error={save.error} />
      <div>
        <Button
          variant="primary"
          disabled={selected.size === 0}
          loading={save.isPending}
          // Keep the order the accounts are listed in.
          onClick={() => save.mutate(accounts.filter((a) => selected.has(a.id)).map((a) => a.id), { onSuccess: () => toasts.add({ title: t('accounts.saved') }) })}
        >
          {t('accounts.save')}
        </Button>
      </div>
    </div>
  );
}
