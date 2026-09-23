import { describe, expect, it } from 'vitest';
import { routeSchema, routesUpdateSchema, adminSetupSchema, uuidSchema } from './schemas';

describe('routeSchema', () => {
  it('accepts http service with hostname', () => {
    expect(routeSchema.parse({ hostname: 'app.example.com', service: 'http://192.168.1.10:8123' }).hostname)
      .toBe('app.example.com');
  });
  it('lowercases and trims hostname', () => {
    expect(routeSchema.parse({ hostname: ' App.Example.com ', service: 'http://a:1' }).hostname).toBe('app.example.com');
  });
  it('rejects hostname without dot', () => {
    expect(() => routeSchema.parse({ hostname: 'localhost', service: 'http://a:1' })).toThrow();
  });
  it('rejects unknown scheme', () => {
    expect(() => routeSchema.parse({ hostname: 'a.example.com', service: 'ftp://a:21' })).toThrow();
  });
  it('accepts ssh, tcp, rdp, unix and http_status services', () => {
    for (const service of ['ssh://10.0.0.2:22', 'tcp://10.0.0.2:5432', 'rdp://10.0.0.3:3389', 'unix:/run/app.sock', 'http_status:404']) {
      expect(routeSchema.parse({ hostname: 'a.example.com', service }).service).toBe(service);
    }
  });
  it('accepts path and originRequest options', () => {
    const r = routeSchema.parse({ hostname: 'a.example.com', path: '^/api', service: 'https://10.0.0.2',
      originRequest: { noTLSVerify: true, httpHostHeader: 'x', originServerName: 'y', connectTimeout: '10s', keepAliveTimeout: '90s' } });
    expect(r.originRequest?.noTLSVerify).toBe(true);
  });
});

describe('routesUpdateSchema', () => {
  it('requires numeric version', () => {
    expect(() => routesUpdateSchema.parse({ routes: [] })).toThrow();
    expect(routesUpdateSchema.parse({ version: 3, routes: [] }).overwriteDns).toEqual([]);
  });
});

describe('adminSetupSchema', () => {
  it('requires 12+ char password', () => {
    expect(() => adminSetupSchema.parse({ username: 'admin', password: 'short' })).toThrow();
    expect(adminSetupSchema.parse({ username: 'admin', password: 'a-very-long-pass' }).username).toBe('admin');
  });
});

describe('uuidSchema', () => {
  it('rejects path traversal', () => {
    expect(() => uuidSchema.parse('../../etc/passwd')).toThrow();
    expect(uuidSchema.parse('6ff42ae2-765d-4adf-8112-31c55c1551ef')).toBeTruthy();
  });
});
