import { describe, expect, it } from 'vitest';
import { buildTokenTemplateUrl } from './token-link';

describe('buildTokenTemplateUrl', () => {
  it('prefills permissions for all accounts and zones', () => {
    const u = new URL(buildTokenTemplateUrl('cloudflared-manager'));
    expect(u.origin + u.pathname).toBe('https://dash.cloudflare.com/profile/api-tokens');
    expect(JSON.parse(u.searchParams.get('permissionGroupKeys')!)).toEqual([
      { key: 'argotunnel', type: 'edit' },
      { key: 'dns', type: 'edit' },
      { key: 'zone', type: 'read' },
      // Lets GET /accounts list accounts that have no domain yet.
      { key: 'account_settings', type: 'read' },
    ]);
    expect(u.searchParams.get('accountId')).toBe('*');
    expect(u.searchParams.get('zoneId')).toBe('all');
    expect(u.searchParams.get('name')).toBe('cloudflared-manager');
  });
});
