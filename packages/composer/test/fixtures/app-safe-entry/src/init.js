import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../init-ran.marker', import.meta.url), 'full init ran\n');

throw new Error('DB connect failed: onModuleInit (full bootstrap would fail loudly)');