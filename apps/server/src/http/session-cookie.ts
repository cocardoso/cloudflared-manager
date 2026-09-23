import type { FastifyReply } from 'fastify';
import type { AppContext } from './context';

export const SESSION_COOKIE = 'tm_session';

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'strict', path: '/', secure: ctx.config.cookieSecure, maxAge: 7 * 24 * 3600,
  });
}
