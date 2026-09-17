import contract from '../../../specs/023-local-dev-server/contracts/local-dev-server.json';
import {
  JDT_CODES,
  JDT_IAM_UNAVAILABLE,
  JDT_INVALID_PORT,
  LocalDevServerError,
  redactSecrets,
} from '../src/server/diagnostics';

interface ContractShape {
  definitions: { jdtDiagnosticCode: { enum: string[] } };
}

describe('diagnostics (FR-029)', () => {
  it('exposes exactly the contract diagnostic codes, byte-for-byte', () => {
    const enumValues = (contract as unknown as ContractShape).definitions.jdtDiagnosticCode.enum;
    expect(JDT_CODES).toEqual(enumValues);
    expect(JDT_CODES).toHaveLength(8);
  });

  it('includes JDT_IAM_UNAVAILABLE as a warning code', () => {
    expect(JDT_CODES).toContain(JDT_IAM_UNAVAILABLE);
  });

  it('includes the additive JDT_INVALID_PORT code', () => {
    expect(JDT_CODES).toContain(JDT_INVALID_PORT);
  });

  it('shapes LocalDevServerError with code/name/cause', () => {
    const cause = new Error('EADDRINUSE');
    const error = new LocalDevServerError('JDT_PORT_IN_USE', 'port busy', cause);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LocalDevServerError);
    expect(error.name).toBe('LocalDevServerError');
    expect(error.code).toBe('JDT_PORT_IN_USE');
    expect(error.message).toBe('port busy');
    expect(error.cause).toBe(cause);
  });

  it('creates a LocalDevServerError without a cause', () => {
    const error = new LocalDevServerError('JDT_NO_TRANSPORT', 'no transport');
    expect(error.cause).toBeUndefined();
  });

  it('redacts every non-empty secret value and leaves clean text intact', () => {
    const text = 'token=a1 auth=Bearer b2 cookie=session=c3 done';
    const result = redactSecrets(text, ['a1', 'Bearer b2', 'session=c3']);
    expect(result).toBe('token=[REDACTED] auth=[REDACTED] cookie=[REDACTED] done');
  });

  it('handles undefined and empty secrets', () => {
    expect(redactSecrets('clean text', [undefined, '', 'a1'])).toBe('clean text');
    expect(redactSecrets('', ['a1'])).toBe('');
  });

  it('redacts longer secrets before shorter overlapping ones', () => {
    expect(redactSecrets('value=abc-token', ['abc', 'abc-token'])).toBe('value=[REDACTED]');
  });
});
