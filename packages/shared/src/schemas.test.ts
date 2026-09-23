import { describe, expect, it } from 'vitest';
import { adminSetupSchema, backupSchema, enabledAccountsSchema, cloudflareTokenSchema, createTunnelSchema, routeSchema, routesUpdateSchema, uuidSchema } from './schemas';
import { ERROR_CODES } from './errors';

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
      originRequest: { noTLSVerify: true, httpHostHeader: 'x', originServerName: 'y', connectTimeout: 10, keepAliveTimeout: 90 } });
    expect(r.originRequest?.noTLSVerify).toBe(true);
  });
  it('uses integer seconds for timeouts, like the Cloudflare API', () => {
    expect(() => routeSchema.parse({ hostname: 'a.example.com', service: 'http://a:1', originRequest: { connectTimeout: '30s' } })).toThrow();
  });
  it('keeps origin options set in the Cloudflare dashboard that the form does not know', () => {
    const r = routeSchema.parse({ hostname: 'a.example.com', service: 'https://a:1', originRequest: { http2Origin: true, caPool: '/ca.pem' } });
    expect(r.originRequest).toEqual({ http2Origin: true, caPool: '/ca.pem' });
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

describe('account selection', () => {
  const A = 'a'.repeat(32);
  it('createTunnelSchema takes an optional account id', () => {
    expect(createTunnelSchema.parse({ name: 'home' })).toEqual({ name: 'home' });
    expect(createTunnelSchema.parse({ name: 'home', accountId: A })).toEqual({ name: 'home', accountId: A });
    expect(createTunnelSchema.safeParse({ name: 'home', accountId: 'x' }).success).toBe(false);
  });
  it('cloudflareTokenSchema no longer carries an account', () => {
    expect(cloudflareTokenSchema.parse({ token: 't'.repeat(40), accountId: A })).toEqual({ token: 't'.repeat(40) });
  });
  it('backupSchema accepts tunnels with and without an account', () => {
    const t = { id: '6ff42ae2-765d-4adf-8112-31c55c1551ef', keepAlive: true, toleranceMinutes: 2, logLevel: 'info', protocol: 'auto' };
    expect(backupSchema.parse({ version: 1, tunnels: [t], managedDns: [] }).tunnels[0]).not.toHaveProperty('accountId');
    expect(backupSchema.parse({ version: 1, tunnels: [{ ...t, accountId: A }], managedDns: [] }).tunnels[0]!.accountId).toBe(A);
  });
  it('knows ACCOUNT_NOT_FOUND', () => {
    expect(ERROR_CODES).toContain('ACCOUNT_NOT_FOUND');
  });
});

describe('enabledAccountsSchema', () => {
  it('needs at least one valid account id', () => {
    expect(enabledAccountsSchema.parse({ enabled: ['a'.repeat(32)] })).toEqual({ enabled: ['a'.repeat(32)] });
    expect(enabledAccountsSchema.safeParse({ enabled: [] }).success).toBe(false);
    expect(enabledAccountsSchema.safeParse({ enabled: ['x'] }).success).toBe(false);
  });
  it('knows ACCOUNT_IN_USE', () => {
    expect(ERROR_CODES).toContain('ACCOUNT_IN_USE');
  });
});
