import { routeSchema, type Route, type Zone } from '@tm/shared';

export const SERVICE_TYPES = ['http', 'https', 'tcp', 'ssh', 'rdp', 'unix', 'http_status'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export interface RouteFormValues {
  subdomain: string;
  zone: string;
  path: string;
  type: ServiceType;
  target: string;
  noTLSVerify: boolean;
  httpHostHeader: string;
  originServerName: string;
  connectTimeout: string;
  keepAliveTimeout: string;
}

export const emptyForm = (zone = ''): RouteFormValues => ({
  subdomain: '', zone, path: '', type: 'http', target: '',
  noTLSVerify: false, httpHostHeader: '', originServerName: '', connectTimeout: '', keepAliveTimeout: '',
});

export function routeToForm(r: Route, zones: Zone[]): RouteFormValues {
  const zone = zones
    .filter((z) => r.hostname === z.name || r.hostname.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const subdomain = zone ? r.hostname.slice(0, Math.max(0, r.hostname.length - zone.name.length - 1)) : r.hostname;
  const m = /^([a-z_]+):(?:\/\/)?(.*)$/.exec(r.service);
  const type = (SERVICE_TYPES as readonly string[]).includes(m?.[1] ?? '') ? (m![1] as ServiceType) : 'http';
  const o = r.originRequest ?? {};
  return {
    subdomain,
    zone: zone?.name ?? '',
    path: r.path ?? '',
    type,
    target: m?.[2] ?? r.service,
    noTLSVerify: !!o.noTLSVerify,
    httpHostHeader: o.httpHostHeader ?? '',
    originServerName: o.originServerName ?? '',
    connectTimeout: o.connectTimeout ? String(o.connectTimeout) : '',
    keepAliveTimeout: o.keepAliveTimeout ? String(o.keepAliveTimeout) : '',
  };
}

const FORM_KEYS = ['noTLSVerify', 'httpHostHeader', 'originServerName', 'connectTimeout', 'keepAliveTimeout'];
const seconds = (v: string) => (v.trim() ? Number(v.trim()) : undefined);

export function hostnameOf(v: Pick<RouteFormValues, 'subdomain' | 'zone'>) {
  const sub = v.subdomain.trim().toLowerCase();
  return sub ? `${sub}.${v.zone}` : v.zone;
}

/**
 * Validates with the shared schema; throws a ZodError on invalid input.
 * When editing, origin options the form does not manage are carried over from `original`.
 */
export function formToRoute(v: RouteFormValues, original?: Route | null): Route {
  // Strip only a scheme the user typed ("http://…", "unix:…"); "origin:80" is a host and port.
  const target = v.target.trim().replace(/^(?:(?:https?|tcp|ssh|rdp|smb|unix\+tls):\/\/|unix:|http_status:)/i, '');
  if (!target) throw new Error('missing target');
  const service = v.type === 'unix' ? `unix:${target}` : v.type === 'http_status' ? `http_status:${target}` : `${v.type}://${target}`;
  const preserved = Object.fromEntries(Object.entries(original?.originRequest ?? {}).filter(([k]) => !FORM_KEYS.includes(k)));
  const originRequest = Object.fromEntries(
    Object.entries({
      ...preserved,
      noTLSVerify: v.noTLSVerify || undefined,
      httpHostHeader: v.httpHostHeader.trim() || undefined,
      originServerName: v.originServerName.trim() || undefined,
      connectTimeout: seconds(v.connectTimeout),
      keepAliveTimeout: seconds(v.keepAliveTimeout),
    }).filter(([, x]) => x !== undefined),
  );
  return routeSchema.parse({
    hostname: hostnameOf(v),
    ...(v.path.trim() ? { path: v.path.trim() } : {}),
    service,
    ...(Object.keys(originRequest).length ? { originRequest } : {}),
  });
}

export function moveRoute(routes: Route[], index: number, dir: -1 | 1): Route[] {
  const j = index + dir;
  if (j < 0 || j >= routes.length) return routes;
  const out = [...routes];
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}
