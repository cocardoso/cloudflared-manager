import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import type { AppContext } from './context';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backup';
import { cloudflareRoutes } from './routes/cloudflare';
import { setupRoutes } from './routes/setup';
import { systemRoutes } from './routes/system';
import { tunnelRoutes } from './routes/tunnels';
import { SESSION_COOKIE } from './session-cookie';

const PUBLIC = new Set(['/api/health', '/api/setup/status', '/api/setup/admin', '/api/auth/login']);

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === 'production' ? { level: 'info' } : false, disableRequestLogging: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ code: err.code, message: err.message, details: err.details });
    if (err instanceof ZodError) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.issues });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many attempts, try again in a minute' });
    if (status && status >= 400 && status < 500) return reply.code(status).send({ code: 'VALIDATION_ERROR', message: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ code: 'INTERNAL', message: 'Internal error' });
  });

  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || PUBLIC.has(path)) return;
    const token = req.cookies[SESSION_COOKIE];
    if (!token || !ctx.sessions.validate(token)) throw new AppError('UNAUTHORIZED', 'Login required', 401);
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(
    async (api) => {
      await setupRoutes(api, ctx);
      await authRoutes(api, ctx);
      await cloudflareRoutes(api, ctx);
      await tunnelRoutes(api, ctx);
      await systemRoutes(api, ctx);
      await backupRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  const webDist = ctx.config.webDist;
  if (webDist) await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (!webDist || req.url.startsWith('/api/')) return reply.code(404).send({ code: 'VALIDATION_ERROR', message: 'Not found' });
    return reply.sendFile('index.html');
  });
  return app;
}
