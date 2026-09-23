import type { CloudflaredVersionInfo } from '@tm/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import { compareVersions } from '../../system/cloudflared-info';
import type { AppContext } from '../context';

export async function systemRoutes(app: FastifyInstance, ctx: AppContext) {
  const info = async (): Promise<CloudflaredVersionInfo> => {
    const [installed, latest] = await Promise.all([ctx.backend.cloudflaredVersion(), ctx.latestVersion()]);
    return {
      installed, latest, canSelfUpdate: ctx.backend.canSelfUpdate,
      updateAvailable: !!installed && !!latest && compareVersions(installed, latest) < 0,
    };
  };

  app.get('/system/cloudflared', info);

  app.post('/system/cloudflared/update', async () => {
    if (!ctx.backend.canSelfUpdate) {
      throw new AppError('CLOUDFLARED_UPDATE_UNSUPPORTED', 'cloudflared is bundled in the container image', 409);
    }
    await ctx.backend.upgradeCloudflared();
    for (const row of ctx.tunnels.list()) {
      if ((await ctx.backend.status(row.id)).state === 'active') await ctx.backend.restart(row.id);
    }
    const result = await info();
    ctx.events.add(null, 'cloudflared-updated', `cloudflared is now ${result.installed}`);
    return result;
  });
}
