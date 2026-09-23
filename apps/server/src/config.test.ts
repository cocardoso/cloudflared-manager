import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('resolves relative directories to absolute paths', () => {
    const c = loadConfig({ DATA_DIR: '.data', ETC_DIR: '.data/etc', WEB_DIST: 'apps/web/dist' });
    expect(isAbsolute(c.dataDir)).toBe(true);
    expect(isAbsolute(c.etcDir)).toBe(true);
    expect(isAbsolute(c.webDist!)).toBe(true);
  });
  it('uses production defaults', () => {
    expect(loadConfig({})).toMatchObject({ port: 8080, dataDir: '/var/lib/tunnel-manager', etcDir: '/etc/tunnel-manager', serviceBackend: 'systemd', webDist: null });
  });
});
