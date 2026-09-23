import { createTunnelSchema, routesUpdateSchema, testOriginSchema, updateTunnelSchema, uuidSchema } from '@tm/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors';
import { testOrigin } from '../../system/origin-test';
import type { AppContext } from '../context';

const idOf = (req: FastifyRequest) => {
  const r = uuidSchema.safeParse((req.params as { id: string }).id);
  if (!r.success) throw new AppError('VALIDATION_ERROR', 'invalid tunnel id', 400);
  return r.data.toLowerCase();
};
const limitOf = (v: unknown, fallback: number) => z.coerce.number().int().min(1).max(1000).parse(v ?? fallback);

export async function tunnelRoutes(app: FastifyInstance, ctx: AppContext) {
  const s = ctx.service;

  app.get('/tunnels', () => s.list());
  app.post('/tunnels', async (req, reply) => {
    const { name, accountId } = createTunnelSchema.parse(req.body);
    return reply.code(201).send(await s.create(name, accountId));
  });
  app.get('/tunnels/:id', (req) => s.get(idOf(req)));
  app.patch('/tunnels/:id', (req) => s.update(idOf(req), updateTunnelSchema.parse(req.body)));
  app.delete('/tunnels/:id', async (req, reply) => {
    const id = idOf(req);
    await s.delete(id);
    ctx.sampler.forget(id);
    return reply.code(204).send();
  });
  app.post('/tunnels/:id/adopt', (req) => s.adopt(idOf(req)));
  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post(`/tunnels/:id/${action}`, async (req, reply) => {
      await s[action](idOf(req));
      return reply.code(204).send();
    });
  }
  app.put('/tunnels/:id/routes', (req) => s.updateRoutes(idOf(req), routesUpdateSchema.parse(req.body)));
  app.get('/tunnels/:id/events', (req) => ctx.events.list({ tunnelId: idOf(req), limit: limitOf((req.query as { limit?: string }).limit, 100) }));
  app.get('/tunnels/:id/metrics', async (req) => ctx.sampler.snapshot(idOf(req)));
  app.get('/tunnels/:id/logs', (req) => ctx.backend.logs(idOf(req), limitOf((req.query as { lines?: string }).lines, 200)));
  app.get('/tunnels/:id/logs/stream', (req, reply) => {
    const id = idOf(req);
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    reply.raw.write(': connected\n\n');
    const unsubscribe = ctx.backend.followLogs(id, (line) => reply.raw.write(`data: ${JSON.stringify(line)}\n\n`));
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
  app.get('/events', (req) => ctx.events.list({ limit: limitOf((req.query as { limit?: string }).limit, 50) }));
  app.post('/tools/test-origin', (req) => testOrigin(testOriginSchema.parse(req.body).service));
}
