import { Toasty } from '@cloudflare/kumo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

export type Handler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

/** Routes fetch calls by "METHOD /path" (query string ignored) and records them. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const h = routes[key];
    if (!h) throw new Error(`unmocked ${key}`);
    return h(init, url);
  });
  return calls;
}

export function renderWithProviders(ui: ReactNode, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Toasty>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </Toasty>
    </QueryClientProvider>,
  );
}
