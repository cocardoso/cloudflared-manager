import { CloudflareLogo, LayerCard, Text } from '@cloudflare/kumo';
import type { ReactNode } from 'react';
import { Disclaimer } from './disclaimer';

/** Centered card used by the setup and login screens. */
export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <CloudflareLogo variant="glyph" className="h-8 w-auto" />
        <Text variant="heading" size="lg">Cloudflared Manager</Text>
      </div>
      <LayerCard className="w-full max-w-lg">
        <LayerCard.Secondary>
          <div className="flex flex-col gap-1">
            <Text variant="heading" size="lg" as="h1">{title}</Text>
            {subtitle && <Text variant="secondary">{subtitle}</Text>}
          </div>
        </LayerCard.Secondary>
        <LayerCard.Primary>
          <div className="flex flex-col gap-4 p-1">{children}</div>
        </LayerCard.Primary>
      </LayerCard>
      {aside}
      <Disclaimer className="max-w-lg" />
    </div>
  );
}
