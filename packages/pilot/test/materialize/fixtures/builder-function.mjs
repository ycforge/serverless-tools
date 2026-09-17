import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Emits a ycforge:function artifact (spec 028 Fix-2) so real yandex-function materializers can run. */
export default {
  build: async (context) => {
    // spec 035 (D1/D2): like builders-core, return the ABSOLUTE archive path —
    // the build pipeline normalizes it to the infra-relative form.
    const archivePath = join(context.projectRoot, 'dist', `${context.sourcePath}.zip`);
    mkdirSync(dirname(archivePath), { recursive: true });
    writeFileSync(archivePath, 'spec-028-function-archive-bytes');
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