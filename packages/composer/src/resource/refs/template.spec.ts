import { describe, expect, it } from 'vitest';

import { TEMPLATE_RE, makeTemplate } from './template.js';

describe('template — syntax constants and helpers (T007, FR-005/007)', () => {
  it('TEMPLATE_RE matches the full canonical template with 3 capture groups', () => {
    const match = TEMPLATE_RE.exec('${resources.queues.events.qurl}');
    expect(match).not.toBeNull();
    expect(match?.slice(1)).toEqual(['queues', 'events', 'qurl']);
  });

  it('makeTemplate produces the artifact-facing template string', () => {
    expect(makeTemplate({ domain: 'functions', name: 'legacy_authorizer', property: 'id' })).toBe(
      '${resources.functions.legacy_authorizer.id}',
    );
    expect(makeTemplate({ domain: 'queues', name: 'events', property: 'qurl' })).toBe(
      '${resources.queues.events.qurl}',
    );
  });

  it('malformed / foreign interpolations do NOT match (FR-014)', () => {
    for (const s of [
      '${var.foo}',
      '${yandex_function.x.id}',
      '{{$ENV}}',
      '$${resources.functions.auth.id}',
      '${resources.}',
      '${resources.functions.auth}',
      '${resources.functions.auth.id.extra}',
      '${resources.functions.auth-id.id}',
      'prefix ${resources.functions.auth.id} suffix',
    ]) {
      expect(TEMPLATE_RE.test(s), s).toBe(false);
    }
  });
});