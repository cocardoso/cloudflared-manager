import { cloudflareTokenSchema, type CloudflareStatus } from '@tm/shared';
import type { FastifyInstance } from 'fastify';
import { CfApi } from '../../cloudflare/api';
import { AppError } from '../../errors';
import type { AppContext } from '../context';

const TUNNEL_PERMISSION = 'Account: Cloudflare Tunnel: Edit';
const ZONE_PERMISSION = 'Zone: Zone: Read';

const withPermission = (permission: string) => (e: unknown) => {
  if (e instanceof AppError && e.code === 'CF_PERMISSION_MISSING') e.details = { permission };
  throw e;
};

export async function cloudflareRoutes(app: FastifyInstance, ctx: AppContext) {
  const status = async (): Promise<CloudflareStatus> => {
    const c = ctx.settings.getCloudflare();
    if (!c) return { connected: false, accountId: null, accountName: null, tokenSuffix: null, zones: [] };
    const zones = await ctx.api().listZones().then((l) => l.map(({ id, name }) => ({ id, name }))).catch(() => []);
    return { connected: true, accountId: c.accountId, accountName: c.accountName, tokenSuffix: ctx.settings.tokenSuffix(), zones };
  };

  app.get('/cloudflare/status', status);
  app.get('/zones', async () => (await ctx.api().listZones()).map(({ id, name }) => ({ id, name })));

  app.post('/cloudflare/token', async (req) => {
    const { token, accountId } = cloudflareTokenSchema.parse(req.body);
    const client = ctx.cfClient(token);
    const v = await CfApi.verifyToken(client);
    if (v.status !== 'active') throw new AppError('CF_TOKEN_INVALID', `Token status is ${v.status}`, 401);
    const accounts = await CfApi.listAccounts(client);
    if (!accounts.length) throw new AppError('CF_PERMISSION_MISSING', 'Token has no account access', 403, { permission: TUNNEL_PERMISSION });
    const account = accountId ? accounts.find((a) => a.id === accountId) : accounts.length === 1 ? accounts[0] : undefined;
    if (!account) throw new AppError('ACCOUNT_SELECTION_REQUIRED', 'Choose an account', 409, { accounts });
    const api = new CfApi(client, account.id);
    await api.listTunnels().catch(withPermission(TUNNEL_PERMISSION));
    const zones = await api.listZones().catch(withPermission(ZONE_PERMISSION));
    if (!zones.length) throw new AppError('CF_PERMISSION_MISSING', 'Token cannot read any zone', 403, { permission: ZONE_PERMISSION });
    ctx.settings.setCloudflare({ token, accountId: account.id, accountName: account.name });
    return status();
  });
}
