import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CloudflareStatus, CloudflaredVersionInfo, MetricsSnapshot, OriginTestResult, Route, SetupStatus,
  TunnelDetail, TunnelEvent, TunnelSummary, UpdateTunnel,
} from '@tm/shared';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from './client';

export const qk = {
  setup: ['setup'] as const,
  me: ['me'] as const,
  cf: ['cf'] as const,
  tunnels: ['tunnels'] as const,
  tunnel: (id: string) => ['tunnel', id] as const,
  events: (id?: string) => ['events', id ?? 'all'] as const,
  metrics: (id: string) => ['metrics', id] as const,
  cloudflared: ['cloudflared'] as const,
};

export const useSetupStatus = () => useQuery({ queryKey: qk.setup, queryFn: () => api.get<SetupStatus>('/setup/status') });
export const useMe = (enabled = true) =>
  useQuery({ queryKey: qk.me, queryFn: () => api.get<{ username: string }>('/auth/me'), retry: false, enabled });
export const useCloudflareStatus = () => useQuery({ queryKey: qk.cf, queryFn: () => api.get<CloudflareStatus>('/cloudflare/status') });
export const useTunnels = () =>
  useQuery({ queryKey: qk.tunnels, queryFn: () => api.get<TunnelSummary[]>('/tunnels'), refetchInterval: 10_000 });
export const useTunnel = (id: string) =>
  useQuery({ queryKey: qk.tunnel(id), queryFn: () => api.get<TunnelDetail>(`/tunnels/${id}`), refetchInterval: 10_000 });
export const useTunnelEvents = (id: string) =>
  useQuery({ queryKey: qk.events(id), queryFn: () => api.get<TunnelEvent[]>(`/tunnels/${id}/events`), refetchInterval: 15_000 });
export const useRecentEvents = () =>
  useQuery({ queryKey: qk.events(), queryFn: () => api.get<TunnelEvent[]>('/events?limit=8'), refetchInterval: 15_000 });
export const useTunnelMetrics = (id: string) =>
  useQuery({ queryKey: qk.metrics(id), queryFn: () => api.get<MetricsSnapshot>(`/tunnels/${id}/metrics`), refetchInterval: 60_000 });
export const useCloudflaredInfo = () =>
  useQuery({ queryKey: qk.cloudflared, queryFn: () => api.get<CloudflaredVersionInfo>('/system/cloudflared') });

function useInvalidating<V, R>(fn: (v: V) => Promise<R>, keys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k }))) });
}

type Credentials = { username: string; password: string };

export const useSetupAdmin = () => useInvalidating((b: Credentials) => api.post('/setup/admin', b), [qk.setup, qk.me]);
export const useLogin = () => useInvalidating((b: Credentials) => api.post('/auth/login', b), [qk.me, qk.setup]);
export const useLogout = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.post('/auth/logout'), onSuccess: () => qc.clear() });
};
export const useChangePassword = () =>
  useMutation({ mutationFn: (b: { currentPassword: string; newPassword: string }) => api.post('/auth/password', b) });
export const useConnectCloudflare = () =>
  useInvalidating((b: { token: string; accountId?: string }) => api.post<CloudflareStatus>('/cloudflare/token', b), [qk.cf, qk.setup, qk.tunnels]);
export const useCreateTunnel = () => useInvalidating((name: string) => api.post<TunnelSummary>('/tunnels', { name }), [qk.tunnels, qk.events()]);
export const useUpdateTunnel = (id: string) =>
  useInvalidating((b: UpdateTunnel) => api.patch<TunnelSummary>(`/tunnels/${id}`, b), [qk.tunnels, qk.tunnel(id), qk.events(id)]);
export const useTunnelAction = (id: string) =>
  useInvalidating((a: 'start' | 'stop' | 'restart' | 'adopt') => api.post(`/tunnels/${id}/${a}`), [qk.tunnels, qk.tunnel(id), qk.events(id), qk.events()]);
export const useDeleteTunnel = () => useInvalidating((id: string) => api.del(`/tunnels/${id}`), [qk.tunnels, qk.events()]);
export const useSaveRoutes = (id: string) =>
  useInvalidating(
    (b: { version: number; routes: Route[]; overwriteDns?: string[]; keepDns?: string[] }) => api.put<TunnelDetail>(`/tunnels/${id}/routes`, b),
    [qk.tunnel(id), qk.tunnels, qk.events(id)],
  );
export const useTestOrigin = () =>
  useMutation({ mutationFn: (service: string) => api.post<OriginTestResult>('/tools/test-origin', { service }) });
export const useUpdateCloudflared = () =>
  useInvalidating(() => api.post<CloudflaredVersionInfo>('/system/cloudflared/update'), [qk.cloudflared, qk.tunnels]);

/** Translates an API error code into a user-facing message. */
export function useErrorMessage() {
  const { t } = useTranslation();
  return (e: unknown) => {
    if (e instanceof ApiError) {
      const d = (e.details ?? {}) as { permission?: string; accountName?: string; cloudflare?: { code: number; message: string }[] };
      const key = e.code === 'CF_PERMISSION_MISSING' && d.accountName ? 'errors.CF_PERMISSION_MISSING_ACCOUNT' : `errors.${e.code}`;
      const text = t(key, { permission: d.permission, account: d.accountName, defaultValue: e.message });
      const cf = Array.isArray(d.cloudflare) ? d.cloudflare.map((x) => `${x.code} ${x.message}`).join('; ') : '';
      return cf ? `${text} ${t('errors.cloudflareSaid', { detail: cf })}` : text;
    }
    return t('errors.INTERNAL');
  };
}
