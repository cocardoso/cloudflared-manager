import { cloudflareTokenSchema, enabledAccountsSchema, type CloudflareStatus } from '@tm/shared';
import type { FastifyInstance } from 'fastify';
import { AccountDirectory } from '../../cloudflare/account-directory';
import { CfApi } from '../../cloudflare/api';
import { AppError } from '../../errors';
import type { AppContext } from '../context';

const TUNNEL_PERMISSION = 'Account: Cloudflare Tunnel: Edit';
const ZONE_PERMISSION = 'Zone: Zone: Read';

/** Names the permission that is missing while keeping Cloudflare's own error for diagnosis. */
const withPermission = (permission: string, accountName?: string) => (e: unknown) => {
  if (e instanceof AppError && e.code === 'CF_PERMISSION_MISSING') e.details = { permission, accountName, cloudflare: e.details };
  throw e;
};

export async function cloudflareRoutes(app: FastifyInstance, ctx: AppContext) {
  const status = async (): Promise<CloudflareStatus> => {
    if (!ctx.settings.getCloudflare()) return { connected: false, tokenSuffix: null, lastAccountId: null, accounts: [] };
    const accounts = await ctx.accounts.listAll().catch(() => []);
    const enabled = ctx.settings.enabledAccounts();
    return {
      connected: true,
      tokenSuffix: ctx.settings.tokenSuffix(),
      lastAccountId: ctx.settings.lastAccountId(),
      accounts: accounts.map((a) => ({
        id: a.id, name: a.name, enabled: !enabled || enabled.includes(a.id), zones: a.zones.map(({ id, name }) => ({ id, name })),
      })),
    };
  };

  app.get('/cloudflare/status', status);

  /** Accepts a token that can manage tunnels in at least one account and read at least one zone. */
  app.post('/cloudflare/token', async (req) => {
    const { token } = cloudflareTokenSchema.parse(req.body);
    const client = ctx.cfClient(token);
    const v = await CfApi.verifyToken(client);
    if (v.status !== 'active') throw new AppError('CF_TOKEN_INVALID', `Token status is ${v.status}`, 401);
    const accounts = await new AccountDirectory(() => client).list().catch(withPermission(ZONE_PERMISSION));
    if (!accounts.length) throw new AppError('CF_PERMISSION_MISSING', 'Token has no account access', 403, { permission: TUNNEL_PERMISSION });
    const results = await Promise.allSettled(accounts.map((a) => new CfApi(client, a.id).listTunnels()));
    if (!results.some((r) => r.status === 'fulfilled')) {
      const i = results.findIndex((r) => r.status === 'rejected');
      withPermission(TUNNEL_PERMISSION, accounts[i]!.name)((results[i] as PromiseRejectedResult).reason);
    }
    if (!accounts.some((a) => a.zones.length)) {
      throw new AppError('CF_PERMISSION_MISSING', 'Token cannot read any zone', 403, { permission: ZONE_PERMISSION });
    }
    ctx.settings.setCloudflare({ token });
    // Keep the active accounts the new token still reaches; none left means all are active again.
    const previous = ctx.settings.enabledAccounts();
    if (previous) {
      const kept = previous.filter((id) => accounts.some((a) => a.id === id));
      ctx.settings.setEnabledAccounts(kept.length ? kept : null);
    }
    ctx.accounts.invalidate();
    return status();
  });

  /** Chooses the active accounts; accounts with tunnels running here cannot be turned off. */
  app.put('/cloudflare/accounts', async (req) => {
    const { enabled } = enabledAccountsSchema.parse(req.body);
    const all = await ctx.accounts.listAll();
    const unknown = enabled.filter((id) => !all.some((a) => a.id === id));
    if (unknown.length) throw new AppError('ACCOUNT_NOT_FOUND', 'Account is not reachable with this token', 404, { accountIds: unknown });
    const names = ctx.settings.accountNames();
    const inUse = [...new Set(ctx.tunnels.list().flatMap((r) => (r.accountId && !enabled.includes(r.accountId) ? [r.accountId] : [])))];
    if (inUse.length) {
      const accounts = inUse.map((id) => all.find((a) => a.id === id)?.name ?? names[id] ?? id);
      throw new AppError('ACCOUNT_IN_USE', 'Tunnels of these accounts run on this host', 409, { accounts });
    }
    ctx.settings.setEnabledAccounts([...new Set(enabled)]);
    return status();
  });
}
