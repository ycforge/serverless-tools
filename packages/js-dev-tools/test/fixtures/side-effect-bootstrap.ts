// Documentation-only fixture (Sc9, A-6): the canonical bootstrap guards the
// server behind a main-guard so the module stays side-effect-free when imported
// by the dev server. The dev server does not detect side effects — it only
// rejects entries that export no module (FR-005, JDT_ENTRY_MODULE_NOT_FOUND).
import path from 'node:path';
import { createYcsfLocalServer } from '@ycforge/js-dev-tools/server';

const isMain =
  process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isMain) {
  // Production entry point: the server only starts when the file is run directly.
  const s = await createYcsfLocalServer({ entry: './src/app.module.ts', port: 3000 });
  process.once('SIGINT', () => void s.stop());
}