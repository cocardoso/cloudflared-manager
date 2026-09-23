import type { LinkComponentProps } from '@cloudflare/kumo';
import { forwardRef } from 'react';
import { Link } from 'react-router';

/**
 * Bridges Kumo links to client-side routing; external URLs stay plain anchors.
 * Most Kumo components pass `href`, but some (e.g. Breadcrumbs.Link) pass `to`,
 * so accept either — like Kumo's own default link component does.
 */
export const AppLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(({ href, to, ...rest }, ref) => {
  const target = href ?? to ?? '';
  return /^https?:\/\//.test(target) ? <a ref={ref} href={target} {...rest} /> : <Link ref={ref} to={target} {...rest} />;
});
AppLink.displayName = 'AppLink';
