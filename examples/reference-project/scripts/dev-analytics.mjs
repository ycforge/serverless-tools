import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createYcsfLocalServer } from '@ycforge/serverless-dev-tools/server';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'apps/analytics/dist/app.module.js');
const PORT = Number(process.env.PORT ?? 8080);

if (!existsSync(DIST)) {
  const message =
    'apps/analytics/dist/app.module.js not found — run `pnpm build:analytics` first (tsc emits design:paramtypes that esbuild/tsx cannot)';
  process.stderr.write(message + '\n');
  process.exit(1);
}

const server = await createYcsfLocalServer({
  entry: DIST,
  port: PORT,
  yandexContext: { region: 'ru-central1' },
});

console.log(`analytics on ${server.baseUrl} (fail-open: no IAM token)`);

async function shutdown() {
  await server.stop();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);