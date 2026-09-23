import { Text } from '@cloudflare/kumo';
import { useTranslation } from 'react-i18next';

/** Makes clear the app is independent from Cloudflare and names its trademarks. */
export function Disclaimer({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <footer className={`text-center ${className}`}>
      <Text variant="secondary" size="xs">{t('app.disclaimer')}</Text>
    </footer>
  );
}
