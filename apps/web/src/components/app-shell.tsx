import { CloudflareLogo, Select, Sidebar, Text } from '@cloudflare/kumo';
import { GearIcon, SignOutIcon, TreeStructureIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useLogout, useMe } from '../api/hooks';
import { LANGUAGES, setLanguage } from '../i18n';

export function AppShell() {
  const { t, i18n } = useTranslation();
  const loc = useLocation();
  const nav = useNavigate();
  const logout = useLogout();
  const me = useMe();
  const onTunnels = loc.pathname === '/' || loc.pathname.startsWith('/tunnels');

  return (
    <Sidebar.Provider defaultOpen className="min-h-screen">
      <Sidebar>
        <Sidebar.Header>
          <div className="flex items-center gap-2 px-2 py-1">
            <CloudflareLogo variant="glyph" className="h-6 w-auto shrink-0" />
            <div className="flex min-w-0 flex-col">
              <Text bold truncate>{t('app.name')}</Text>
              <Text variant="secondary" size="xs" truncate>{t('app.tagline')}</Text>
            </div>
          </div>
        </Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.Menu>
              <Sidebar.MenuButton icon={TreeStructureIcon} href="/" active={onTunnels} tooltip={t('nav.tunnels')}>
                {t('nav.tunnels')}
              </Sidebar.MenuButton>
              <Sidebar.MenuButton icon={GearIcon} href="/settings" active={loc.pathname === '/settings'} tooltip={t('nav.settings')}>
                {t('nav.settings')}
              </Sidebar.MenuButton>
            </Sidebar.Menu>
          </Sidebar.Group>
        </Sidebar.Content>
        <Sidebar.Footer>
          <div className="flex flex-col gap-2 px-2 pb-2">
            <Select
              label={t('nav.language')}
              hideLabel
              value={i18n.resolvedLanguage ?? 'en'}
              onValueChange={(v) => void setLanguage(String(v ?? 'en'))}
              items={Object.fromEntries(LANGUAGES.map((l) => [l.value, l.label]))}
            />
            <Sidebar.Menu>
              <Sidebar.MenuButton
                icon={SignOutIcon}
                tooltip={t('nav.logout')}
                onClick={async () => {
                  await logout.mutateAsync();
                  nav('/login');
                }}
              >
                {me.data ? `${t('nav.logout')} (${me.data.username})` : t('nav.logout')}
              </Sidebar.MenuButton>
            </Sidebar.Menu>
          </div>
        </Sidebar.Footer>
      </Sidebar>
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </div>
      </main>
    </Sidebar.Provider>
  );
}
