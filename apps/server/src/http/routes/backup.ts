import { backupSchema, type Backup } from '@tm/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';

export async function backupRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/backup', async (_req, reply) => {
    const body: Backup = {
      version: 1,
      tunnels: ctx.tunnels.list().map((t) => ({
        id: t.id, keepAlive: t.keepAlive, toleranceMinutes: t.toleranceMinutes, logLevel: t.logLevel, protocol: t.protocol,
      })),
      managedDns: ctx.dns.all(),
    };
    reply.header('content-disposition', 'attachment; filename="cloudflared-manager-backup.json"');
    return body;
  });

  app.post('/backup', async (req, reply) => {
    const b = backupSchema.parse(req.body);
    for (const t of b.tunnels) {
      if (ctx.tunnels.get(t.id)) {
        ctx.tunnels.update(t.id, { keepAlive: t.keepAlive, toleranceMinutes: t.toleranceMinutes, logLevel: t.logLevel, protocol: t.protocol });
      }
    }
    for (const m of b.managedDns) ctx.dns.upsert(m);
    return reply.code(204).send();
  });
}
