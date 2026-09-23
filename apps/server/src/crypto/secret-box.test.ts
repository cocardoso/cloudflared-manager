import { describe, expect, it } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decrypt, encrypt, loadOrCreateKey } from './secret-box';

describe('secret-box', () => {
  it('round-trips', () => {
    const key = loadOrCreateKey(join(mkdtempSync(join(tmpdir(), 'tm-')), 'secret.key'));
    expect(decrypt(key, encrypt(key, 'cf-token-123'))).toBe('cf-token-123');
  });
  it('produces different ciphertext each time', () => {
    const key = Buffer.alloc(32, 1);
    expect(encrypt(key, 'x')).not.toBe(encrypt(key, 'x'));
  });
  it('fails with wrong key', () => {
    const boxed = encrypt(Buffer.alloc(32, 1), 'x');
    expect(() => decrypt(Buffer.alloc(32, 2), boxed)).toThrow();
  });
  it('creates key file with 0600 and reuses it', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'tm-')), 'secret.key');
    const k1 = loadOrCreateKey(p);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(loadOrCreateKey(p).equals(k1)).toBe(true);
  });
});
