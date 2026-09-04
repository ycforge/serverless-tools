import { writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [entryPath] = process.argv.slice(2);

if (!entryPath) {
  writeSync(2, 'SERVERLESS_TOOLS_RUNNER:LOAD runner invoked without an entry path\n');
  process.exit(1);
}

function fail(type, detail) {
  const line = `SERVERLESS_TOOLS_RUNNER:${type} ${String(detail).split('\n').join(' ')}\n`;
  try {
    writeSync(2, line);
  } catch {
    // stderr unavailable — the parent fails with ENTRY_EXECUTION_FAILED anyway
  }
  process.exit(1);
}

function isOpenApiDocument(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.openapi === 'string' &&
    value.openapi.length > 0 &&
    typeof value.paths === 'object' &&
    value.paths !== null &&
    !Array.isArray(value.paths)
  );
}

async function main() {
  let mod;
  try {
    mod = await import(pathToFileURL(entryPath).href);
  } catch (err) {
    return fail('LOAD', `Failed to load entry ${entryPath}: ${err?.message ?? err}`);
  }

  const build = mod?.buildYcsfOpenApi;

  if (typeof build !== 'function') {
    return fail(
      'LOAD',
      `Entry ${entryPath} does not export buildYcsfOpenApi() (the export name must be exactly 'buildYcsfOpenApi')`,
    );
  }

  let doc;
  try {
    doc = await build();
  } catch (err) {
    return fail('EXEC', `buildYcsfOpenApi() threw: ${err?.stack ?? err?.message ?? err}`);
  }

  if (!isOpenApiDocument(doc)) {
    return fail(
      'INVALID',
      "buildYcsfOpenApi() did not resolve to an OpenApiDocument (object with non-empty string 'openapi' and object 'paths')",
    );
  }

  writeSync(1, JSON.stringify(doc) + '\n');
  process.exit(0);
}

main().catch((err) => fail('EXEC', err?.message ?? err));