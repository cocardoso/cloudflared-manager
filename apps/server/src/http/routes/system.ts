import type { CloudflaredVersionInfo } from '@tm/shared';
import type { FastifyInstance } from 'fastify';
import { compareVersions } from '../../system/cloudflared-info';
import type { AppContext } from '../context';

export async function systemRoutes(app: FastifyInstance, ctx: AppContext) {
  const info = async (): Promise<CloudflaredVersionInfo> => {
    const [installed, latest] = await Promise.all([ctx.backend.cloudflaredVersion(), ctx.latestVersion()]);
    return { installed, latest, updateAvailable: !!installed && !!latest && compareVersions(installed, latest) < 0 };
  };

  app.get('/system/cloudflared', info);

  app.post('/system/cloudflared/update', async () => {
    await ctx.backend.upgradeCloudflared();
    for (const row of ctx.tunnels.list()) {
      if ((await ctx.backend.status(row.id)).state === 'active') await ctx.backend.restart(row.id);
    }
    const result = await info();
    ctx.events.add(null, 'cloudflared-updated', `cloudflared is now ${result.installed}`);
    return result;
  });
}
