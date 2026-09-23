import { LinkProvider, Loader, Toasty } from '@cloudflare/kumo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { useMe, useSetupStatus } from './api/hooks';
import { AppLink } from './components/app-link';
import { AppShell } from './components/app-shell';
import { DashboardPage } from './pages/dashboard';
import { LoginPage } from './pages/login';
import { SettingsPage } from './pages/settings';
import { SetupPage } from './pages/setup';
import { TunnelPage } from './pages/tunnel';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

export function FullPageLoader() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Loader size="lg" />
    </div>
  );
}

/** Routes the user to setup or login until the app is usable. */
function Gate() {
  const setup = useSetupStatus();
  const me = useMe(!!setup.data?.adminCreated);
  const nav = useNavigate();

  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.clear();
      nav('/login');
    };
    window.addEventListener('tm:unauthorized', onUnauthorized);
    return () => window.removeEventListener('tm:unauthorized', onUnauthorized);
  }, [nav]);

  if (setup.isLoading || (setup.data?.adminCreated && me.isLoading)) return <FullPageLoader />;
  if (!setup.data?.adminCreated) return <Navigate to="/setup" replace />;
  if (!me.data) return <Navigate to="/login" replace />;
  if (!setup.data.cloudflareConnected) return <Navigate to="/setup" replace />;
  return <AppShell />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toasty>
        <BrowserRouter>
          <LinkProvider component={AppLink}>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route element={<Gate />}>
                <Route index element={<DashboardPage />} />
                <Route path="/tunnels/:id" element={<TunnelPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </LinkProvider>
        </BrowserRouter>
      </Toasty>
    </QueryClientProvider>
  );
}
