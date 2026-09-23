import { changePasswordSchema, loginSchema } from '@tm/shared';
import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from '../../auth/password';
import { AppError } from '../../errors';
import type { AppContext } from '../context';
import { SESSION_COOKIE, setSessionCookie } from '../session-cookie';

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);
    const admin = ctx.admin.get();
    if (!admin || admin.username !== username || !(await verifyPassword(password, admin.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
    }
    setSessionCookie(ctx, reply, ctx.sessions.create());
    return reply.code(204).send();
  });

  app.post('/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) ctx.sessions.revoke(t);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', async () => ({ username: ctx.admin.get()!.username }));

  app.post('/auth/password', async (req, reply) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const admin = ctx.admin.get()!;
    if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is wrong', 401);
    }
    ctx.admin.setPasswordHash(await hashPassword(newPassword));
    ctx.sessions.revokeAll();
    setSessionCookie(ctx, reply, ctx.sessions.create());
    return reply.code(204).send();
  });
}
