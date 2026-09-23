/** Opens Cloudflare's "Create Token" form with the permissions this app needs already filled in. */
export function buildTokenTemplateUrl(name = 'cloudflared-manager') {
  const perms = [
    { key: 'argotunnel', type: 'edit' },
    { key: 'dns', type: 'edit' },
    { key: 'zone', type: 'read' },
  ];
  const q = new URLSearchParams({ permissionGroupKeys: JSON.stringify(perms), accountId: '*', zoneId: 'all', name });
  return `https://dash.cloudflare.com/profile/api-tokens?${q.toString()}`;
}
