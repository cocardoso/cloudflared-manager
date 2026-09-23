import { Breadcrumbs, Link, LinkProvider } from '@cloudflare/kumo';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppLink } from './app-link';

function renderAt(route: string, ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LinkProvider component={AppLink}>
        <Routes>
          <Route index element={<p>list page</p>} />
          <Route path="/docs" element={<p>docs page</p>} />
          <Route path="/tunnels/:id" element={ui} />
        </Routes>
      </LinkProvider>
    </MemoryRouter>,
  );
}

describe('AppLink', () => {
  // Kumo's Breadcrumbs.Link hands the provider `to={href}` instead of `href`.
  it('navigates from a breadcrumb link back to the list', async () => {
    renderAt(
      '/tunnels/abc',
      <Breadcrumbs>
        <Breadcrumbs.Link href="/">Tunnels</Breadcrumbs.Link>
        <Breadcrumbs.Separator />
        <Breadcrumbs.Current>home</Breadcrumbs.Current>
      </Breadcrumbs>,
    );
    const links = screen.getAllByRole('link', { name: 'Tunnels' });
    for (const l of links) expect(l.getAttribute('href')).toBe('/');
    await userEvent.click(links[0]!);
    expect(await screen.findByText('list page')).toBeTruthy();
  });

  it('routes internal Kumo links client-side and keeps external ones as anchors', async () => {
    renderAt(
      '/tunnels/abc',
      <>
        <Link href="https://example.com">external</Link>
        <Link href="/docs">docs</Link>
      </>,
    );
    expect(screen.getByRole('link', { name: 'external' }).getAttribute('href')).toBe('https://example.com');
    await userEvent.click(screen.getByRole('link', { name: 'docs' }));
    expect(await screen.findByText('docs page')).toBeTruthy();
  });
});
