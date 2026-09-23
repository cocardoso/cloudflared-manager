import { describe, expect, it } from 'vitest';
import { configToRoutes, diffHostnames, routesToConfig } from './ingress';
import { findZoneForHostname } from './zones';

const r = (hostname: string, service = 'http://10.0.0.1:80', path?: string) => ({ hostname, service, ...(path ? { path } : {}) });

describe('configToRoutes / routesToConfig', () => {
  it('strips catch-all and re-adds it at the end', () => {
    const cfg = { ingress: [r('a.example.com'), { service: 'http_status:404' }] };
    const routes = configToRoutes(cfg);
    expect(routes).toEqual([r('a.example.com')]);
    expect(routesToConfig(routes, cfg).ingress.at(-1)).toEqual({ service: 'http_status:404' });
  });
  it('preserves global originRequest and warp-routing', () => {
    const base = { ingress: [{ service: 'http_status:404' }], originRequest: { connectTimeout: '5s' }, 'warp-routing': { enabled: true } };
    const out = routesToConfig([r('a.example.com')], base);
    expect(out.originRequest).toEqual({ connectTimeout: '5s' });
    expect(out['warp-routing']).toEqual({ enabled: true });
  });
  it('handles empty ingress', () => {
    expect(configToRoutes({ ingress: [] })).toEqual([]);
  });
});

describe('diffHostnames', () => {
  it('detects added and removed hosts', () => {
    expect(diffHostnames([r('a.example.com')], [r('b.example.com')])).toEqual({ added: ['b.example.com'], removed: ['a.example.com'] });
  });
  it('does not remove host still used by another path rule', () => {
    const before = [r('a.example.com', 'http://x:1', '^/api'), r('a.example.com')];
    const after = [r('a.example.com')];
    expect(diffHostnames(before, after)).toEqual({ added: [], removed: [] });
  });
});

describe('findZoneForHostname', () => {
  const zones = [{ id: '1', name: 'example.com' }, { id: '2', name: 'sub.example.com' }, { id: '3', name: 'other.dev' }];
  it('picks longest suffix', () => {
    expect(findZoneForHostname('x.sub.example.com', zones)?.id).toBe('2');
    expect(findZoneForHostname('a.example.com', zones)?.id).toBe('1');
    expect(findZoneForHostname('example.com', zones)?.id).toBe('1');
  });
  it('does not match partial labels', () => {
    expect(findZoneForHostname('notexample.com', zones)).toBeNull();
  });
  it('supports wildcard', () => {
    expect(findZoneForHostname('*.other.dev', zones)?.id).toBe('3');
  });
});
