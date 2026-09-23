import type { ApiErrorBody, ErrorCode } from '@tm/shared';

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const e = (data && typeof data === 'object' && 'code' in data ? data : { code: 'INTERNAL', message: res.statusText }) as ApiErrorBody;
    if (res.status === 401 && e.code === 'UNAUTHORIZED') window.dispatchEvent(new Event('tm:unauthorized'));
    throw new ApiError(e.code, e.message, res.status, e.details);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: (p: string) => request<void>('DELETE', p),
};
