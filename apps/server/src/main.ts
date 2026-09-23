import { loadConfig } from './config';
import { buildApp } from './http/app';
import { createContext } from './http/context';
import { probeInternet, probeReady } from './watchdog/probes';
import { Watchdog } from './watchdog/watchdog';

const config = loadConfig();
const ctx = createContext(config);
const app = await buildApp(ctx);

const watchdog = new Watchdog({ tunnels: ctx.tunnels, backend: ctx.backend, events: ctx.events, probeReady, probeInternet });
watchdog.start(30_000);
const metricsTimer = setInterval(() => {
  for (const t of ctx.tunnels.list()) void ctx.sampler.sample(t.id, t.metricsPort);
}, 60_000);

const shutdown = async () => {
  watchdog.stop();
  clearInterval(metricsTimer);
  await app.close();
  ctx.db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port: config.port, host: config.host });
console.log(`cloudflared-manager listening on http://${config.host}:${config.port} (backend=${config.serviceBackend})`);
