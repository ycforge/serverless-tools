import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Emits a ycforge:function artifact (spec 028 Fix-2) so real yandex-function materializers can run. */
export default {
  build: async (context) => {
    const archivePath = `dist/${context.sourcePath}.zip`;
    const builtZip = join(context.projectRoot, archivePath);
    mkdirSync(dirname(builtZip), { recursive: true });
    writeFileSync(builtZip, 'spec-028-function-archive-bytes');
    return {
      type: 'ycforge:function',
      name: context.sourcePath,
      value: {
        archivePath,
        entryPoint: 'index.handler',
      },
    };
  },
};