import { AppError } from '../errors';
import type { CfEnvelope } from './types';

/** Thin fetch wrapper that unwraps Cloudflare's envelope and maps failures to AppError codes. */
export class CfClient {
  private fetchImpl: typeof fetch;

  constructor(private opts: { token: string; baseUrl: string; fetch?: typeof fetch }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async raw<T>(method: string, path: string, body?: unknown): Promise<CfEnvelope<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.baseUrl + path, {
        method,
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new AppError('CF_UNREACHABLE', `Cloudflare API unreachable: ${(e as Error).message}`, 502);
    }
    let env: CfEnvelope<T>;
    try {
      env = (await res.json()) as CfEnvelope<T>;
    } catch {
      throw new AppError('CF_API_ERROR', `Invalid response from Cloudflare (HTTP ${res.status})`, 502);
    }
    if (res.ok && env.success) return env;
    const msg = env.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
    if (res.status === 401) throw new AppError('CF_TOKEN_INVALID', msg, 401, env.errors);
    if (res.status === 403) throw new AppError('CF_PERMISSION_MISSING', msg, 403, env.errors);
    if (res.status === 429) throw new AppError('CF_RATE_LIMITED', msg, 429, env.errors);
    if (res.status === 404 && path.includes('/cfd_tunnel/')) throw new AppError('TUNNEL_NOT_FOUND', msg, 404, env.errors);
    throw new AppError('CF_API_ERROR', msg, 502, env.errors);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.raw<T>(method, path, body)).result;
  }

  async paginate<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; ; page++) {
      const env = await this.raw<T[]>('GET', `${path}${sep}page=${page}`);
      out.push(...env.result);
      if (!env.result_info || page >= env.result_info.total_pages) return out;
    }
  }
}
