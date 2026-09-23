const CACHE_MS = 6 * 3600e3;
let cache: { at: number; value: string | null } | null = null;

export function compareVersions(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Latest cloudflared release tag from GitHub, cached for 6 h (only for the real fetch). */
export async function latestCloudflaredVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const cacheable = fetchImpl === fetch;
  if (cacheable && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const r = await fetchImpl('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    });
    const value = r.ok ? (((await r.json()) as { tag_name?: string }).tag_name ?? null) : null;
    if (cacheable) cache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}
