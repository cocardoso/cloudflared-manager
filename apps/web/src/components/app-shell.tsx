import { Button, CloudflareLogo, DropdownMenu, Sidebar, Text, Tooltip } from '@cloudflare/kumo';
import { GearIcon, GlobeIcon, SignOutIcon, TreeStructureIcon } from '@phosphor-icons/react';
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
    <Sidebar.Provider defaultOpen className="h-svh">
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
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <DropdownMenu>
              <DropdownMenu.Trigger
                render={
                  <Button variant="ghost" size="sm" icon={<GlobeIcon />} aria-label={t('nav.language')}>
                    {LANGUAGES.find((l) => l.value === i18n.resolvedLanguage)?.label ?? 'English'}
                  </Button>
                }
              />
              <DropdownMenu.Content>
                {LANGUAGES.map((l) => (
                  <DropdownMenu.Item key={l.value} onClick={() => void setLanguage(l.value)}>
                    {l.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu>
            <Tooltip content={me.data ? `${t('nav.logout')} (${me.data.username})` : t('nav.logout')}>
              <Button
                variant="ghost"
                size="sm"
                shape="square"
                icon={<SignOutIcon />}
                aria-label={t('nav.logout')}
                loading={logout.isPending}
                onClick={async () => {
                  await logout.mutateAsync();
                  nav('/login');
                }}
              />
            </Tooltip>
          </div>
        </Sidebar.Footer>
      </Sidebar>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-kumo-line bg-kumo-canvas px-4 py-2 md:hidden">
          <Sidebar.Trigger />
          <CloudflareLogo variant="glyph" className="h-5 w-auto" />
          <Text bold>{t('app.name')}</Text>
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </div>
      </main>
    </Sidebar.Provider>
  );
}
