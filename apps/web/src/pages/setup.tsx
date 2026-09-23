import { Button, Input, Loader, SensitiveInput, Text } from '@cloudflare/kumo';
import { CheckIcon } from '@phosphor-icons/react';
import { adminSetupSchema } from '@tm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { useMe, useSetupAdmin, useSetupStatus } from '../api/hooks';
import { AuthLayout } from '../components/auth-layout';
import { ConnectCloudflareForm } from '../components/connect-cloudflare-form';
import { ErrorBanner } from '../components/error-banner';

function Steps({ current }: { current: 1 | 2 }) {
  const { t } = useTranslation();
  const steps = [t('setup.step1'), t('setup.step2')];
  return (
    <ol className="flex items-center gap-3">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${
                active ? 'bg-kumo-brand text-white' : done ? 'bg-kumo-success text-white' : 'bg-kumo-recessed text-kumo-subtle'
              }`}
            >
              {done ? <CheckIcon weight="bold" /> : n}
            </span>
            <Text size="sm" variant={active ? 'body' : 'secondary'}>{label}</Text>
            {n < steps.length && <span className="mx-1 h-px w-6 bg-kumo-line" />}
          </li>
        );
      })}
    </ol>
  );
}

function AdminStep() {
  const { t } = useTranslation();
  const create = useSetupAdmin();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (password.length < 12) next.password = t('setup.passwordHint');
    else if (password !== confirm) next.confirm = t('setup.passwordMismatch');
    setErrors(next);
    if (next.password || next.confirm) return;
    const parsed = adminSetupSchema.safeParse({ username, password });
    if (parsed.success) create.mutate(parsed.data);
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Input label={t('setup.username')} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      <SensitiveInput
        label={t('setup.password')}
        description={errors.password ? undefined : t('setup.passwordHint')}
        error={errors.password}
        value={password}
        onValueChange={setPassword}
        autoComplete="new-password"
      />
      <SensitiveInput
        label={t('setup.confirmPassword')}
        error={errors.confirm}
        value={confirm}
        onValueChange={setConfirm}
        autoComplete="new-password"
      />
      <ErrorBanner error={create.error} />
      <Button type="submit" variant="primary" loading={create.isPending}>
        {t('setup.createAdmin')}
      </Button>
    </form>
  );
}

export function SetupPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const status = useSetupStatus();
  const me = useMe(!!status.data?.adminCreated);
  const [finished, setFinished] = useState(false);

  if (status.isLoading || (status.data?.adminCreated && me.isLoading)) {
    return <div className="grid min-h-screen place-items-center"><Loader size="lg" /></div>;
  }
  if (status.data?.adminCreated && !me.data) return <Navigate to="/login" replace />;
  if (status.data?.adminCreated && status.data.cloudflareConnected && !finished) return <Navigate to="/" replace />;

  const step = status.data?.adminCreated ? 2 : 1;
  return (
    <AuthLayout title={t('setup.title')} subtitle={t('setup.subtitle')}>
      <Steps current={step} />
      {step === 1 ? (
        <AdminStep />
      ) : (
        <>
          <ConnectCloudflareForm onConnected={() => setFinished(true)} />
          {finished && (
            <Button variant="primary" onClick={() => nav('/')}>
              {t('setup.finish')}
            </Button>
          )}
        </>
      )}
    </AuthLayout>
  );
}
