import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SystemdBackend, type Runner } from './systemd-backend';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';
const sudoers = readFileSync(join(import.meta.dirname, '../../../../deploy/sudoers'), 'utf8');

/** Every sudoers command must be an anchored regex (^...$) so wildcards cannot swallow extra arguments. */
function allowedPatterns() {
  const joined = sudoers.replace(/\\\n\s*/g, '');
  const aliases = [...joined.matchAll(/^Cmnd_Alias \w+ = (.+)$/gm)].flatMap((m) => m[1]!.split(/,\s*(?=\/usr\/bin\/)/));
  return aliases.map((c) => {
    const [bin, ...rest] = c.trim().split(' ');
    const args = rest.join(' ');
    expect(args.startsWith('^') && args.endsWith('$'), `not anchored: ${c}`).toBe(true);
    // sudo unescapes "\,", "\:", "\=" and "\\" before compiling the regex.
    return { bin: bin!, re: new RegExp(args.replace(/\\([,:=\\])/g, '$1')) };
  });
}
const allowed = (cmd: string[]) => {
  const [bin, ...args] = cmd;
  return allowedPatterns().some((p) => p.bin === `/usr/bin/${bin}` && p.re.test(args.join(' ')));
};

describe('sudoers policy', () => {
  it('allows exactly the commands the backend runs', async () => {
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => {
      if (cmd === 'sudo') calls.push(args.slice(1));
      return { stdout: '', stderr: '', code: 0 };
    };
    const b = new SystemdBackend(mkdtempSync(join(tmpdir(), 'tm-')), run);
    await b.install(ID, { token: 't', metricsPort: 1, logLevel: 'info', protocol: 'auto' });
    await b.start(ID);
    await b.stop(ID);
    await b.restart(ID);
    await b.logs(ID, 200);
    await b.uninstall(ID);
    await b.upgradeCloudflared();
    calls.push(['journalctl', '-u', `cloudflared@${ID}.service`, '-o', 'json', '-n', '0', '-f', '--no-pager']);
    for (const c of calls) expect(allowed(c), c.join(' ')).toBe(true);
  });
  it('rejects argument smuggling', () => {
    expect(allowed(['systemctl', '--no-block', 'start', `cloudflared@${ID}.service`, '/var/lib/tunnel-manager/evil.service'])).toBe(false);
    expect(allowed(['systemctl', 'enable', 'cloudflared@x.service', '/tmp/evil.service'])).toBe(false);
    expect(allowed(['systemctl', 'enable', 'ssh.service'])).toBe(false);
    expect(allowed(['journalctl', '-u', `cloudflared@${ID}.service`, '--vacuum-size=1'])).toBe(false);
    expect(allowed(['journalctl', '-u', '*', '-o', 'json', '-n', '5', '--no-pager'])).toBe(false);
  });
  it('starts units without blocking on cloudflared readiness', async () => {
    const calls: string[] = [];
    const run: Runner = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '', stderr: '', code: 0 };
    };
    const b = new SystemdBackend('/x', run);
    await b.start(ID);
    await b.restart(ID);
    expect(calls).toEqual([
      `sudo -n systemctl --no-block start cloudflared@${ID}.service`,
      `sudo -n systemctl --no-block restart cloudflared@${ID}.service`,
    ]);
  });
});
