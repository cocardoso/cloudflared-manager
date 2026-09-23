/** Longest-suffix match of a hostname against the account's zones. */
export function findZoneForHostname<Z extends { id: string; name: string }>(hostname: string, zones: Z[]): Z | null {
  const host = hostname.replace(/^\*\./, '');
  let best: Z | null = null;
  for (const z of zones) {
    if ((host === z.name || host.endsWith(`.${z.name}`)) && (!best || z.name.length > best.name.length)) best = z;
  }
  return best;
}
