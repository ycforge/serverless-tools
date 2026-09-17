import { LocalDevServerError } from '../src/server/diagnostics';
import { loadEntryModule } from '../src/server/entry';

function captureError(entry: string): Promise<LocalDevServerError> {
  return loadEntryModule(entry).then(
    (_module) => {
      throw new Error(`expected loadEntryModule to reject for ${entry}`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(LocalDevServerError);
      return error as LocalDevServerError;
    },
  );
}

describe('loadEntryModule (FR-005/FR-006, S-3)', () => {
  it('loads a named AppModule export', async () => {
    const moduleClass = await loadEntryModule('./test/fixtures/user-service/app.module.ts');
    expect(typeof moduleClass).toBe('function');
    expect(moduleClass.name).toBe('AppModule');
  });

  it('falls back to the default export', async () => {
    const moduleClass = await loadEntryModule(
      './test/fixtures/user-service/default-export.ts',
    );
    expect(moduleClass.name).toBe('DefaultAppModule');
  });

  it('resolves a CommonJS default-export class through Node interop', async () => {
    const moduleClass = await loadEntryModule('./test/fixtures/user-service/cjs-entry.cjs');
    expect(typeof moduleClass).toBe('function');
    expect(moduleClass.name).toBe('CjsInlineAppModule');
  });

  it('rejects when the entry has no module export', async () => {
    const error = await captureError('./test/fixtures/user-service/no-module.ts');
    expect(error.code).toBe('JDT_ENTRY_MODULE_NOT_FOUND');
  });

  it('rejects when named AppModule and default disagree', async () => {
    const error = await captureError('./test/fixtures/user-service/ambiguous.ts');
    expect(error.code).toBe('JDT_ENTRY_MODULE_AMBIGUOUS');
  });

  it('rejects a non-existent entry path', async () => {
    const error = await captureError('./test/fixtures/user-service/does-not-exist.ts');
    expect(error.code).toBe('JDT_ENTRY_RESOLVE_FAILED');
  });

  it('rejects an import that throws, preserving the cause', async () => {
    const error = await captureError('./test/fixtures/user-service/throws-on-import.ts');
    expect(error.code).toBe('JDT_ENTRY_RESOLVE_FAILED');
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toBe('boom-on-import');
  });

  it('resolves relative paths from the working directory', async () => {
    const moduleClass = await loadEntryModule(
      `${process.cwd()}/test/fixtures/user-service/app.module.ts`,
    );
    expect(moduleClass.name).toBe('AppModule');
  });
});