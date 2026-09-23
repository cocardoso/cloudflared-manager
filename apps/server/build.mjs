import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  // Some Fastify dependencies still call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
