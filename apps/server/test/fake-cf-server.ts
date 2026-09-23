import { startFakeCloudflare } from './fake-cloudflare';

// Standalone fake Cloudflare API for end-to-end tests and local development.
const port = Number(process.env.FAKE_CF_PORT ?? 18787);
const cf = await startFakeCloudflare({ port });
console.log(`fake Cloudflare API on ${cf.baseUrl} (token: ${cf.token})`);
