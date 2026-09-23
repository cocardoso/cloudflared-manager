// Stand-in for the cloudflared binary used by ProcessBackend tests.
const args = process.argv.slice(2);
const log = (level, msg) => process.stderr.write(`${new Date().toISOString()} ${level} ${msg}\n`);

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
if (process.env.FAKE_CF_NO_CONNECT !== '1') {
  setTimeout(() => log('INF', 'Registered tunnel connection connIndex=0 event=0 location=gru01 protocol=quic'), 30);
}
if (process.env.FAKE_CF_CRASH === '1') setTimeout(() => { log('ERR', 'crashing'); process.exit(1); }, 50);
setInterval(() => {}, 1000);
