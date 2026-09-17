import { describe, expect, it } from 'vitest';

import { PML_ENV_UNRESOLVED } from '../../src/contracts/index.js';
import { EnvUnresolvedError } from '../../src/build-env/errors.js';

// FR-015 / contracts/build-env.json #/definitions/unresolvedDiagnostic:
// EnvUnresolvedError aggregates one or more PML_ENV_UNRESOLVED diagnostics,
// each carrying code/message/file/app/field (via the shared diag factory shape).

describe('EnvUnresolvedError (FR-015)', () => {
  it('aggregates one or more PML_ENV_UNRESOLVED diagnostics', () => {
    const error = new EnvUnresolvedError([
      {
        code: PML_ENV_UNRESOLVED,
        message: "ENV 'A' is unresolved (build_config for app 'a')",
        file: 'a/build_config.yaml',
        app: 'a',
        field: 'build_config',
      },
      {
        code: PML_ENV_UNRESOLVED,
        message: "ENV 'B' is unresolved (B for app 'a')",
        file: 'a/build_config.yaml',
        app: 'a',
        field: 'B',
      },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EnvUnresolvedError');
    expect(error.code).toBe(PML_ENV_UNRESOLVED);
    expect(error.diagnostics).toHaveLength(2);
    expect(error.diagnostics[0]).toMatchObject({
      code: PML_ENV_UNRESOLVED,
      app: 'a',
      field: 'build_config',
    });
    expect(error.diagnostics[1]).toMatchObject({ code: PML_ENV_UNRESOLVED, field: 'B' });
    expect(error.message).toContain("ENV 'A' is unresolved");
    expect(error.message).toContain("ENV 'B' is unresolved");
  });
});