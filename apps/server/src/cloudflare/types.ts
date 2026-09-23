export interface CfAccount { id: string; name: string }
export interface CfZone { id: string; name: string; status: string; account?: CfAccount }
export interface CfConnection {
  colo_name: string; opened_at: string; origin_ip: string; client_version: string; is_pending_reconnect: boolean;
}
export interface CfTunnel {
  id: string; name: string; created_at: string; deleted_at: string | null;
  status: 'inactive' | 'degraded' | 'healthy' | 'down'; config_src: 'cloudflare' | 'local'; connections: CfConnection[];
}
export interface CfIngressRule { hostname?: string; path?: string; service: string; originRequest?: Record<string, unknown> }
export interface CfTunnelConfig {
  ingress: CfIngressRule[]; originRequest?: Record<string, unknown>; 'warp-routing'?: Record<string, unknown>;
}
export interface CfDnsRecord { id: string; name: string; type: string; content: string; proxied: boolean; comment?: string | null }
export interface CfEnvelope<T> {
  success: boolean; result: T; errors: { code: number; message: string }[];
  // Endpoints differ: some send total_pages, others only total_count (e.g. cfd_tunnel), some neither.
  result_info?: { page?: number; per_page?: number; total_pages?: number; count?: number; total_count?: number };
}
