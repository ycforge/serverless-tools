import { createYcsfLocalServer } from '@ycforge/serverless-dev-tools/server';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(ROOT, 'apps/user_service/src/app.module.ts');
const PORT = Number(process.env.PORT ?? 3000);

const server = await createYcsfLocalServer({
  entry: ENTRY,
  port: PORT,
  yandexContext: { region: 'ru-central1' },
});

console.log(`user_service on ${server.baseUrl} (fail-open: no IAM token)`);

async function shutdown() {
  await server.stop();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);