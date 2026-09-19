// Vendors the built @ycforge/nestjs-connector into e2e/node_modules as a REAL
// directory (only package.json + dist) instead of the pnpm symlink.
//
// Why: the function builder bundles the connector together with the app. With a
// symlink, esbuild resolves the connector to packages/nest-bridge and pulls its
// own devDependency @nestjs/common (11.2.3 from the root store) while the app
// resolves @nestjs/common from the e2e store — two physical copies of Nest in
// one bundle, so `instanceof HttpException` fails (guards return 500). As a real
// directory without a nested node_modules, the connector's peer dependencies
// resolve to the app's single copy (a published package behaves the same way).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const e2eRoot = resolve(import.meta.dirname, '..');
const source = resolve(e2eRoot, '..', 'packages', 'nest-bridge');
const destination = resolve(e2eRoot, 'node_modules', '@ycforge', 'nestjs-connector');

if (!existsSync(resolve(source, 'dist', 'index.js'))) {
  console.error(
    `[vendor-connector] ${source}/dist is missing — run 'pnpm build' at the repository root first`,
  );
  process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(resolve(source, 'package.json'), resolve(destination, 'package.json'));
cpSync(resolve(source, 'dist'), resolve(destination, 'dist'), { recursive: true });

console.log(`[vendor-connector] vendored ${source} -> ${destination}`);
