import { Meter, Text } from '@cloudflare/kumo';
import { useTranslation } from 'react-i18next';
import { passwordStrength } from '../lib/password-strength';

const LEVELS = ['', 'weak', 'fair', 'good', 'strong'] as const;
const COLORS = ['', 'bg-kumo-danger', 'bg-kumo-warning', 'bg-kumo-info', 'bg-kumo-success'] as const;

/** Advice only: any non-empty password is accepted, this just shows how strong it is. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation();
  const level = passwordStrength(password);
  return (
    <div className="flex flex-col gap-1.5">
      {level > 0 && (
        <Meter
          label={t('password.strength')}
          value={level * 25}
          customValue={t(`password.${LEVELS[level]}`)}
          indicatorClassName={COLORS[level]}
        />
      )}
      <Text variant="secondary" size="sm">{t('password.recommendation')}</Text>
    </div>
  );
}
