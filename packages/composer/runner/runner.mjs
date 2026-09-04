import { writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [entryPath] = process.argv.slice(2);

if (!entryPath) {
  writeSync(2, 'SERVERLESS_TOOLS_RUNNER:LOAD\n');
  process.exit(1);
}

function fail(type) {
  try {
    writeSync(2, `SERVERLESS_TOOLS_RUNNER:${type}\n`);
  } catch {
    // stderr unavailable — the parent fails with ENTRY_EXECUTION_FAILED anyway
  }
  process.exit(1);
}

function writeResult(doc) {
  try {
    writeSync(3, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
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
  } catch {
    return fail('LOAD');
  }

  const build = mod?.buildYcsfOpenApi;

  if (typeof build !== 'function') {
    return fail('LOAD');
  }

  let doc;
  try {
    doc = await build();
  } catch {
    return fail('EXEC');
  }

  if (!isOpenApiDocument(doc)) {
    return fail('INVALID');
  }

  // The result travels over a dedicated pipe (fd 3), never mixed with the
  // application's stdout. Failure markers carry no detail: the application's
  // error messages may embed payloads/tokens and must not reach the parent.
  if (!writeResult(doc)) {
    return fail('EXEC');
  }
  process.exit(0);
}

main().catch(() => fail('EXEC'));