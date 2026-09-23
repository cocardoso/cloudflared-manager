import { adminSetupSchema } from '@tm/shared';
import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../../auth/password';
import { AppError } from '../../errors';
import type { AppContext } from '../context';
import { setSessionCookie } from '../session-cookie';

export async function setupRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/setup/status', async () => ({ adminCreated: ctx.admin.exists(), cloudflareConnected: !!ctx.settings.getCloudflare() }));

  app.post('/setup/admin', async (req, reply) => {
    if (ctx.admin.exists()) throw new AppError('SETUP_ALREADY_DONE', 'Admin already created', 409);
    const body = adminSetupSchema.parse(req.body);
    ctx.admin.create(body.username, await hashPassword(body.password));
    setSessionCookie(ctx, reply, ctx.sessions.create());
    return reply.code(201).send({ username: body.username });
  });
}
