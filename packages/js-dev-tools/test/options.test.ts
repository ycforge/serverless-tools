import { LocalDevServerError } from '../src/server/diagnostics';
import { validateOptions } from '../src/server/options';

function expectCode(fn: () => unknown, code: string): LocalDevServerError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LocalDevServerError);
    expect((error as LocalDevServerError).code).toBe(code);
    return error as LocalDevServerError;
  }
  throw new Error(`expected validateOptions to throw ${code}`);
}

describe('validateOptions (FR-002/FR-004)', () => {
  it('applies deterministic defaults', () => {
    expect(validateOptions({ entry: './x.ts' })).toEqual({
      entry: './x.ts',
      apiGatewayV2: true,
      messageQueue: false,
      port: 3000,
      yandexContext: {},
    });
  });

  it('preserves a provided yandexContext object', () => {
    const yandexContext = { token: 't', folderId: 'f' };
    expect(validateOptions({ entry: './x.ts', yandexContext })).toEqual({
      entry: './x.ts',
      apiGatewayV2: true,
      messageQueue: false,
      port: 3000,
      yandexContext,
    });
  });

  it('rejects messageQueue explicitly', () => {
    expectCode(
      () => validateOptions({ entry: './x.ts', messageQueue: true }),
      'JDT_MQ_UNSUPPORTED',
    );
  });

  it('rejects when no transport is enabled', () => {
    expectCode(
      () => validateOptions({ entry: './x.ts', apiGatewayV2: false }),
      'JDT_NO_TRANSPORT',
    );
  });

  it.each([
    ['NaN', Number.NaN],
    ['negative', -1],
    ['too large', 70000],
    ['fractional', 3000.5],
    ['not a number', 'abc'],
  ])('rejects an invalid port (%s)', (_label, port) => {
    expectCode(() => validateOptions({ entry: './x.ts', port }), 'JDT_INVALID_PORT');
  });

  it('rejects an empty entry', () => {
    expectCode(() => validateOptions({ entry: '' }), 'JDT_ENTRY_RESOLVE_FAILED');
  });

  it('rejects a missing entry', () => {
    expectCode(() => validateOptions({}), 'JDT_ENTRY_RESOLVE_FAILED');
  });

  it('rejects a non-object options bag', () => {
    expectCode(() => validateOptions(null), 'JDT_ENTRY_RESOLVE_FAILED');
  });
});
