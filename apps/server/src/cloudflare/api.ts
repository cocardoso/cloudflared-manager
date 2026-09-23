import type { CfClient } from './client';
import type { CfAccount, CfDnsRecord, CfTunnel, CfTunnelConfig, CfZone } from './types';

export const MANAGED_COMMENT = 'managed by cloudflared-manager';

export class CfApi {
  constructor(private c: CfClient, public readonly accountId: string) {}

  static verifyToken(c: CfClient) {
    return c.request<{ status: string }>('GET', '/user/tokens/verify');
  }

  static async listAccounts(c: CfClient): Promise<CfAccount[]> {
    return (await c.paginate<CfAccount>('/accounts?per_page=50')).map(({ id, name }) => ({ id, name }));
  }

  private get t() {
    return `/accounts/${this.accountId}/cfd_tunnel`;
  }

  async listZones(): Promise<CfZone[]> {
    const zones = await this.c.paginate<CfZone>(`/zones?account.id=${this.accountId}&per_page=50`);
    return zones.map(({ id, name, status }) => ({ id, name, status }));
  }

  listTunnels() {
    return this.c.paginate<CfTunnel>(`${this.t}?is_deleted=false&per_page=100`);
  }

  getTunnel(id: string) {
    return this.c.request<CfTunnel>('GET', `${this.t}/${id}`);
  }

  createTunnel(name: string) {
    return this.c.request<CfTunnel>('POST', this.t, { name, config_src: 'cloudflare' });
  }

  renameTunnel(id: string, name: string) {
    return this.c.request<CfTunnel>('PATCH', `${this.t}/${id}`, { name });
  }

  deleteTunnel(id: string) {
    return this.c.request<CfTunnel>('DELETE', `${this.t}/${id}`);
  }

  cleanupConnections(id: string) {
    return this.c.request<null>('DELETE', `${this.t}/${id}/connections`);
  }

  getTunnelToken(id: string) {
    return this.c.request<string>('GET', `${this.t}/${id}/token`);
  }

  async getConfig(id: string): Promise<{ version: number; config: CfTunnelConfig }> {
    const r = await this.c.request<{ version: number; config: CfTunnelConfig | null }>('GET', `${this.t}/${id}/configurations`);
    return { version: r.version, config: r.config ?? { ingress: [{ service: 'http_status:404' }] } };
  }

  async putConfig(id: string, config: CfTunnelConfig): Promise<{ version: number }> {
    const r = await this.c.request<{ version: number }>('PUT', `${this.t}/${id}/configurations`, { config });
    return { version: r.version };
  }

  findDnsRecords(zoneId: string, name: string) {
    return this.c.paginate<CfDnsRecord>(`/zones/${zoneId}/dns_records?name.exact=${encodeURIComponent(name)}&per_page=100`);
  }

  createCname(zoneId: string, name: string, target: string) {
    return this.c.request<CfDnsRecord>('POST', `/zones/${zoneId}/dns_records`, {
      type: 'CNAME', name, content: target, proxied: true, ttl: 1, comment: MANAGED_COMMENT,
    });
  }

  updateCname(zoneId: string, recordId: string, name: string, target: string) {
    return this.c.request<CfDnsRecord>('PUT', `/zones/${zoneId}/dns_records/${recordId}`, {
      type: 'CNAME', name, content: target, proxied: true, ttl: 1, comment: MANAGED_COMMENT,
    });
  }

  deleteDnsRecord(zoneId: string, recordId: string) {
    return this.c.request<{ id: string }>('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  }
}
