import { describe, expect, it } from 'vitest';
import { emptyForm, formToRoute, moveRoute, routeToForm } from './route-model';

const zones = [{ id: '1', name: 'example.com' }, { id: '2', name: 'sub.example.com' }];

describe('route model', () => {
  it('round-trips https route with advanced options', () => {
    const r = { hostname: 'ha.example.com', service: 'https://10.0.0.5:8123', originRequest: { noTLSVerify: true } };
    const f = routeToForm(r, zones);
    expect(f).toMatchObject({ subdomain: 'ha', zone: 'example.com', type: 'https', target: '10.0.0.5:8123', noTLSVerify: true });
    expect(formToRoute(f)).toEqual(r);
  });
  it('converts timeouts to seconds and keeps unknown origin options when editing', () => {
    const original = { hostname: 'a.example.com', service: 'https://10.0.0.1:443', originRequest: { http2Origin: true, connectTimeout: 30 } };
    const f = routeToForm(original, zones);
    expect(f.connectTimeout).toBe('30');
    expect(formToRoute({ ...f, keepAliveTimeout: '90' }, original).originRequest).toEqual({ http2Origin: true, connectTimeout: 30, keepAliveTimeout: 90 });
    expect(formToRoute({ ...f, connectTimeout: '' }, original).originRequest).toEqual({ http2Origin: true });
  });
  it('uses the longest zone and supports apex hostnames', () => {
    expect(routeToForm({ hostname: 'x.sub.example.com', service: 'http://a:1' }, zones)).toMatchObject({ subdomain: 'x', zone: 'sub.example.com' });
    expect(routeToForm({ hostname: 'example.com', service: 'http://a:1' }, zones)).toMatchObject({ subdomain: '', zone: 'example.com' });
    expect(formToRoute({ ...emptyForm('example.com'), target: 'a:1' }).hostname).toBe('example.com');
  });
  it('builds unix and http_status services', () => {
    expect(formToRoute({ ...emptyForm('example.com'), subdomain: 'a', type: 'unix', target: '/run/x.sock' }).service).toBe('unix:/run/x.sock');
    expect(formToRoute({ ...emptyForm('example.com'), subdomain: 'a', type: 'http_status', target: '404' }).service).toBe('http_status:404');
  });
  it('strips a scheme typed into the URL field', () => {
    expect(formToRoute({ ...emptyForm('example.com'), subdomain: 'a', type: 'http', target: 'http://10.0.0.1:80' }).service).toBe('http://10.0.0.1:80');
  });
  it('rejects invalid input', () => {
    expect(() => formToRoute({ ...emptyForm('example.com'), subdomain: 'bad host', target: 'x:1' })).toThrow();
    expect(() => formToRoute({ ...emptyForm('example.com'), subdomain: 'a', target: '' })).toThrow();
  });
  it('moves routes within bounds', () => {
    const rs = [{ hostname: 'a.example.com', service: 'http://a:1' }, { hostname: 'b.example.com', service: 'http://b:1' }];
    expect(moveRoute(rs, 1, -1).map((r) => r.hostname)).toEqual(['b.example.com', 'a.example.com']);
    expect(moveRoute(rs, 0, -1)).toBe(rs);
  });
});
