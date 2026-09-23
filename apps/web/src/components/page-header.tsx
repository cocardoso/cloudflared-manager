import type { ReactNode } from 'react';

/** Page title block following the Cloudflare dashboard layout (Kumo PageHeader block). */
export function PageHeader({ title, description, actions, breadcrumbs, badges }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: ReactNode; badges?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      {breadcrumbs}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-3xl font-semibold text-kumo-default">{title}</h1>
            {badges}
          </div>
          {description && <p className="max-w-prose text-base text-kumo-subtle">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
