import type { CloudflareStatus } from '@tm/shared';

/** The accounts the app works with: tunnels, creation and filters only consider these. */
export const activeAccounts = (s: CloudflareStatus | undefined) => (s?.accounts ?? []).filter((a) => a.enabled);
