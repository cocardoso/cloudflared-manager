import { createServer } from 'node:http';
// Stand-in for the cloudflared binary used by ProcessBackend tests.
const args = process.argv.slice(2);
const LEVELS = { DBG: 0, INF: 1, WRN: 2, ERR: 3, FTL: 4 };
const MIN = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 }[process.env.TUNNEL_LOGLEVEL ?? 'info'] ?? 1;
// Like cloudflared, lines below the configured level are not printed.
const log = (level, msg) => LEVELS[level] >= MIN && process.stderr.write(`${new Date().toISOString()} ${level} ${msg}\n`);

if (args.includes('--version')) {
  process.stdout.write('cloudflared version 2026.9.1 (built 2026-09-11-13:35 UTC)\n');
  process.exit(0);
}

if (process.env.FAKE_CF_IGNORE_TERM === '1') process.on('SIGTERM', () => log('WRN', 'ignoring SIGTERM'));
log('INF', 'Starting tunnel');
log('INF', `metrics=${process.env.TUNNEL_METRICS ?? ''}`);
log('INF', `argv=${JSON.stringify(args)}`);
log('INF', `token-present=${Boolean(process.env.TUNNEL_TOKEN)}`);

// Like the real binary, a connection to the edge is only reported a moment after start.
// Like the real binary, /ready on the metrics server answers 200 once an edge connection is up.
if (process.env.FAKE_CF_NO_CONNECT !== '1') {
  setTimeout(() => {
    log('INF', 'Registered tunnel connection connIndex=0 event=0 location=gru01 protocol=quic');
    const port = Number((process.env.TUNNEL_METRICS ?? '').split(':')[1]);
    // A port still held by another test's process is not this fake's concern.
    if (port) createServer((req, res) => res.writeHead(req.url === '/ready' ? 200 : 404).end()).on('error', () => {}).listen(port, '127.0.0.1');
  }, 30);
}
if (process.env.FAKE_CF_CRASH === '1') setTimeout(() => { log('ERR', 'crashing'); process.exit(1); }, 50);
setInterval(() => {}, 1000);
