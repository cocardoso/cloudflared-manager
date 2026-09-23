import type { Route } from '@tm/shared';
import type { CfIngressRule, CfTunnelConfig } from '../cloudflare/types';

export const CATCH_ALL: CfIngressRule = { service: 'http_status:404' };

export const tunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`;

/** Hostname rules only; the trailing catch-all (and any hostname-less rule) is dropped. */
export function configToRoutes(config: CfTunnelConfig): Route[] {
  return (config.ingress ?? [])
    .filter((rule) => !!rule.hostname)
    .map((rule) => ({
      hostname: rule.hostname!,
      ...(rule.path ? { path: rule.path } : {}),
      service: rule.service,
      ...(rule.originRequest && Object.keys(rule.originRequest).length
        ? { originRequest: rule.originRequest as Route['originRequest'] }
        : {}),
    }));
}

export function routesToConfig(routes: Route[], base: CfTunnelConfig): CfTunnelConfig {
  const ingress: CfIngressRule[] = routes.map((r) => ({
    hostname: r.hostname,
    ...(r.path ? { path: r.path } : {}),
    service: r.service,
    ...(r.originRequest ? { originRequest: r.originRequest } : {}),
  }));
  return {
    ...(base.originRequest ? { originRequest: base.originRequest } : {}),
    ...(base['warp-routing'] ? { 'warp-routing': base['warp-routing'] } : {}),
    ingress: [...ingress, CATCH_ALL],
  };
}

/** A hostname counts as removed only when no rule uses it anymore. */
export function diffHostnames(before: Route[], after: Route[]) {
  const b = new Set(before.map((r) => r.hostname));
  const a = new Set(after.map((r) => r.hostname));
  return { added: [...a].filter((h) => !b.has(h)), removed: [...b].filter((h) => !a.has(h)) };
}
