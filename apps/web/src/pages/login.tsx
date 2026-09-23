import { Button, Input, SensitiveInput } from '@cloudflare/kumo';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { useLogin, useSetupStatus } from '../api/hooks';
import { AuthLayout } from '../components/auth-layout';
import { ErrorBanner } from '../components/error-banner';

export function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const status = useSetupStatus();
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (status.data && !status.data.adminCreated) return <Navigate to="/setup" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await login.mutateAsync({ username, password }).then(() => nav('/'), () => undefined);
  };

  return (
    <AuthLayout title={t('login.title')} subtitle={t('login.subtitle')}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Input label={t('setup.username')} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        <SensitiveInput label={t('setup.password')} value={password} onValueChange={setPassword} autoComplete="current-password" />
        <ErrorBanner error={login.error} />
        <Button type="submit" variant="primary" loading={login.isPending} disabled={!username || !password}>
          {t('login.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
