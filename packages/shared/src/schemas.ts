import { z } from 'zod';

export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const hostnameSchema = z.string().trim().toLowerCase()
  .regex(/^(?=.{1,253}$)(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'invalid hostname');

const serviceSchema = z.string().trim().refine(
  (s) => /^(https?|tcp|ssh|rdp|smb|unix|unix\+tls):/.test(s) || /^http_status:\d{3}$/.test(s) || s === 'hello_world',
  'unsupported service',
);

/** Cloudflare's remote-config API expresses timeouts as integer seconds. */
const secondsSchema = z.number().int().positive().max(86_400);

// Known keys are validated; any other option set in the Cloudflare dashboard is preserved as-is.
export const originRequestSchema = z.looseObject({
  noTLSVerify: z.boolean().optional(),
  httpHostHeader: z.string().min(1).optional(),
  originServerName: z.string().min(1).optional(),
  connectTimeout: secondsSchema.optional(),
  keepAliveTimeout: secondsSchema.optional(),
});

export const routeSchema = z.object({
  hostname: hostnameSchema,
  path: z.string().min(1).optional(),
  service: serviceSchema,
  originRequest: originRequestSchema.optional(),
});

export const routesUpdateSchema = z.object({
  version: z.number().int().nonnegative(),
  routes: z.array(routeSchema).max(200),
  overwriteDns: z.array(hostnameSchema).default([]),
  keepDns: z.array(hostnameSchema).default([]),
});

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);
export const protocolSchema = z.enum(['auto', 'quic', 'http2']);

export const accountIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

const tunnelNameSchema = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/);
export const createTunnelSchema = z.object({ name: tunnelNameSchema, accountId: accountIdSchema.optional() });

export const updateTunnelSchema = z.object({
  name: tunnelNameSchema.optional(),
  keepAlive: z.boolean().optional(),
  toleranceMinutes: z.number().int().min(1).max(60).optional(),
  logLevel: logLevelSchema.optional(),
  protocol: protocolSchema.optional(),
});

export const adminSetupSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  // Any non-empty password is accepted; the UI shows its strength and recommends 12+ characters.
  password: z.string().min(1).max(256),
});
export const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1).max(256) });
export const cloudflareTokenSchema = z.object({ token: z.string().trim().min(20) });
export const enabledAccountsSchema = z.object({ enabled: z.array(accountIdSchema).min(1) });
export const testOriginSchema = z.object({ service: serviceSchema });

export const backupSchema = z.object({
  version: z.literal(1),
  tunnels: z.array(z.object({
    id: uuidSchema, keepAlive: z.boolean(), toleranceMinutes: z.number().int().min(1).max(60),
    logLevel: logLevelSchema, protocol: protocolSchema, accountId: accountIdSchema.optional(),
  })),
  managedDns: z.array(z.object({ recordId: z.string(), zoneId: z.string(), hostname: hostnameSchema, tunnelId: uuidSchema })),
});

export type Route = z.infer<typeof routeSchema>;
export type OriginRequest = z.infer<typeof originRequestSchema>;
export type RoutesUpdate = z.infer<typeof routesUpdateSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type Protocol = z.infer<typeof protocolSchema>;
export type UpdateTunnel = z.infer<typeof updateTunnelSchema>;
export type Backup = z.infer<typeof backupSchema>;
