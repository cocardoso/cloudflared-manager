import type { LinkComponentProps } from '@cloudflare/kumo';
import { forwardRef } from 'react';
import { Link } from 'react-router';

/** Bridges Kumo links (href) to client-side routing; external URLs stay plain anchors. */
export const AppLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(({ href, to: _to, ...rest }, ref) =>
  href && /^https?:\/\//.test(href) ? <a ref={ref} href={href} {...rest} /> : <Link ref={ref} to={href ?? ''} {...rest} />,
);
AppLink.displayName = 'AppLink';
