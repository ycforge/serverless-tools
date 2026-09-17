import { writeSync } from 'node:fs';

writeSync(3, 'this is not a JSON document');
process.exit(0);