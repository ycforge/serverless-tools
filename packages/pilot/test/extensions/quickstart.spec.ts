import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EXT_DUPLICATE_TARGET,
  EXT_INVALID,
  EXT_UNRESOLVED_TARGET,
  EXT_VERSION,
} from '../../src/contracts/index.js';
import type { TerraformResource } from '../../src/contracts/index.js';
import { parseExtensionsYaml } from '../../src/extensions/extensions-yaml.js';
import { applyExtensions, deepMerge, loadExtensions } from '../../src/index.js';
import { serializeResource, serializeResourceFile } from '../../src/materialize/serialize.js';
import {
  canonicalExtensionsYaml,
  canonicalParsedExtensions,
  canonicalResources,
  containerResource,
  functionResource,
  makeExtensions,
  rule,
  writeExtensionsYaml,
} from '../helpers/extensions-fixtures.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

// Phase 4: quickstart.md Sc1–Sc10 against the real loadExtensions /
// applyExtensions / deepMerge (+ 014 serializer for byte-checking).

const CUSTOM_TF = '# user\nresource "yandex_iam_service_account" "custom" {}\nresource "yandex_function_iam_binding" "users" {}\n';

/** Sc1 golden: merged user_service configuration serialized by 014 (byte-compare). */
const GOLDEN_USER_SERVICE_EXTENDED_TF_JSON = `{
  "resource": {
    "yandex_function": {
      "user_service": {
        "entrypoint": "main.handler",
        "environment": {
          "CUSTOM_VAR": "value",
          "NODE_ENV": "production"
        },
        "execution_timeout": "30s",
        "name": "user-service",
        "runtime": "nodejs18",
        "service_account_id": "\${yandex_iam_service_account.custom.id}"
      }
    }
  }
}`;

describe('extensions quickstart (Sc1–Sc10)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) {
      removeTempProject(project);
      project = undefined;
    }
  });

  it('T080 Sc1: env/timeout/service_account patch → ok + golden .tf.json (US-1, FR-008/010/012, Sc1)', () => {
    const resources = canonicalResources();
    const parsed = parseExtensionsYaml(canonicalExtensionsYaml(), '.ycsf/extensions.yaml');
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;

    const result = applyExtensions(resources, parsed.data);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const patched = result.resources[0]!;
    expect(patched).toMatchObject({ kind: 'resource', type: 'yandex_function', name: 'user_service' });
    expect(patched.configuration).toEqual({
      name: 'user-service',
      runtime: 'nodejs18',
      entrypoint: 'main.handler',
      environment: { NODE_ENV: 'production', CUSTOM_VAR: 'value' },
      execution_timeout: '30s',
      service_account_id: '${yandex_iam_service_account.custom.id}',
    });

    const fileResult = serializeResourceFile('user_service', patched);
    expect(fileResult.kind).toBe('ok');
    if (fileResult.kind !== 'ok') return;
    expect(fileResult.file.content).toBe(GOLDEN_USER_SERVICE_EXTENDED_TF_JSON);
    expect(() => JSON.parse(fileResult.file.content)).not.toThrow();
  });

  it('T081 Sc2: custom_domains replaced whole, not appended (US-2, FR-008, Sc2)', () => {
    const resources = canonicalResources();
    const result = applyExtensions(
      resources,
      makeExtensions([
        rule('gateways.openapi', {
          custom_domains: [{ domain_id: '${yandex_api_gateway_domain.main.id}' }],
        }),
      ]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const openapi = result.resources.find((r) => r.name === 'openapi')!;
    const config = openapi.configuration as { custom_domains: readonly { domain_id: string }[] };
    expect(config.custom_domains).toHaveLength(1);
    expect(config.custom_domains).toEqual([{ domain_id: '${yandex_api_gateway_domain.main.id}' }]);

    // same resource patched WITHOUT custom_domains → array untouched (no default clearing)
    const tagsOnly = applyExtensions(
      canonicalResources(),
      makeExtensions([rule('gateways.openapi', { tags: { env: 'prod' } })]),
    );
    expect(tagsOnly.kind).toBe('ok');
    if (tagsOnly.kind !== 'ok') return;
    const openapi2 = tagsOnly.resources.find((r) => r.name === 'openapi')!;
    expect((openapi2.configuration as { custom_domains: readonly unknown[] }).custom_domains).toEqual([
      { domain_id: 'd1' },
    ]);
    expect((openapi2.configuration as { tags: Record<string, unknown> }).tags).toEqual({ env: 'prod' });
  });

  it('T082 Sc3: typo target → EXT_UNRESOLVED_TARGET + alphabetical availableIdls, all-or-nothing (US-3, FR-007, Sc3)', () => {
    const resources = canonicalResources();
    const snapshot = JSON.stringify(resources);
    const result = applyExtensions(
      resources,
      makeExtensions([
        rule('functions.user_servivce', { execution_timeout: '30s' }),
        rule('functions.user_service', { tags: { main: 'http' } }),
      ]),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: EXT_UNRESOLVED_TARGET,
      target: 'functions.user_servivce',
    });
    const message = result.errors[0]?.message ?? '';
    expect(message).toContain('functions.user_servivce');
    expect(message.indexOf('functions.analytics')).toBeGreaterThanOrEqual(0);
    expect(message.indexOf('functions.analytics')).toBeLessThan(message.indexOf('functions.user_service'));
    expect(message.indexOf('functions.user_service')).toBeLessThan(message.indexOf('gateways.openapi'));

    // all-or-nothing: valid second target NOT applied
    expect(JSON.stringify(resources)).toBe(snapshot);

    // grammatically valid, non-existent domain → same code, resolution-level
    const containers = applyExtensions(
      canonicalResources(),
      makeExtensions([rule('containers.user_service', {})]),
    );
    expect(containers.kind).toBe('invalid');
    if (containers.kind !== 'invalid') return;
    expect(containers.errors[0]?.code).toBe(EXT_UNRESOLVED_TARGET);
    expect(containers.errors[0]?.target).toBe('containers.user_service');
  });

  it('T083 Sc4: duplicate target → EXT_DUPLICATE_TARGET, openapi not patched, order duplicate→unresolved (US-4, FR-005/009, Sc4)', () => {
    const resources = canonicalResources();
    const snapshot = JSON.stringify(resources);
    const result = applyExtensions(
      resources,
      makeExtensions([
        rule('functions.user_service', { execution_timeout: '30s' }),
        rule('functions.user_service', { environment: { A: '1' } }),
        rule('gateways.openapi', { custom_domains: [] }),
      ]),
    );
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.some((e) => e.code === EXT_DUPLICATE_TARGET)).toBe(true);
    expect(result.errors[0]).toMatchObject({ code: EXT_DUPLICATE_TARGET, target: 'functions.user_service' });
    expect(JSON.stringify(resources)).toBe(snapshot);

    // ordered: duplicates (by appearance) → unresolved (file order)
    const ordered = applyExtensions(
      resources,
      makeExtensions([
        rule('functions.user_service', {}),
        rule('functions.user_service', {}),
        rule('functions.missing', {}),
      ]),
    );
    expect(ordered.kind).toBe('invalid');
    if (ordered.kind !== 'invalid') return;
    expect(ordered.errors[0]?.code).toBe(EXT_DUPLICATE_TARGET);
    expect(ordered.errors[1]?.code).toBe(EXT_UNRESOLVED_TARGET);
    expect(ordered.errors[1]?.target).toBe('functions.missing');
  });

  it('T084 Sc5: user *.tf byte-identical; no I/O in applyExtensions; passthrough (US-5, FR-014/010/011, SC-003, Sc5)', () => {
    project = createTempProject({});
    writeExtensionsYaml(project, canonicalExtensionsYaml());
    project.write('infra/custom.tf', CUSTOM_TF);
    const yamlPath = join(project.root, '.ycsf/extensions.yaml');
    const tfPath = join(project.root, 'infra/custom.tf');
    const yamlBefore = readFileSync(yamlPath, 'utf8');
    const tfBefore = readFileSync(tfPath, 'utf8');

    const result = applyExtensions(canonicalResources(), canonicalParsedExtensions());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    // applyExtensions determines the result solely from memory — files untouched
    expect(readFileSync(yamlPath, 'utf8')).toBe(yamlBefore);
    expect(readFileSync(tfPath, 'utf8')).toBe(tfBefore);

    // ${...} passthrough byte-for-byte
    const user = result.resources.find((r) => r.name === 'user_service')!;
    expect((user.configuration as { service_account_id: string }).service_account_id).toBe(
      '${yandex_iam_service_account.custom.id}',
    );

    // {{$ENV}} literal passthrough, no interpolation
    const env = applyExtensions(
      canonicalResources(),
      makeExtensions([rule('functions.user_service', { environment: { SECRET: '{{$ENV_REF}}' } })]),
    );
    expect(env.kind).toBe('ok');
    if (env.kind !== 'ok') return;
    const envUser = env.resources.find((r) => r.name === 'user_service')!;
    expect((envUser.configuration as { environment: Record<string, string> }).environment.SECRET).toBe(
      '{{$ENV_REF}}',
    );
  });

  it('T085 Sc6: determinism — two runs deep-equal + byte-identical serialization (US-6, FR-009, SC-001, Sc6)', () => {
    const resources = canonicalResources();
    const yaml = makeExtensions([
      rule('functions.user_service', { execution_timeout: '30s' }),
      rule('gateways.openapi', { tags: { env: 'prod' } }),
    ]);
    const before = JSON.stringify(resources);

    const a = applyExtensions(resources, yaml);
    const b = applyExtensions(resources, yaml);
    expect(a).toEqual(b);
    if (a.kind === 'ok' && b.kind === 'ok') {
      const bytesA = a.resources.map((r) => serializeResource(r)).join('\n');
      const bytesB = b.resources.map((r) => serializeResource(r)).join('\n');
      expect(bytesA).toBe(bytesB);
    }
    expect(JSON.stringify(resources)).toBe(before);
  });

  it('T086 Sc7: loader version/structure errors collect-all (US-7, FR-003/004, Sc7)', () => {
    project = createTempProject({});

    const check = (text: string, expectCodes: readonly string[]): void => {
      const p = project;
      if (p === undefined) throw new Error('project not created');
      writeExtensionsYaml(p, text);
      const result = loadExtensions(p.root);
      expect(result.kind).toBe('invalid');
      if (result.kind === 'ok') return;
      for (const code of expectCodes) {
        expect(result.errors.some((e) => e.code === code)).toBe(true);
      }
      expect(result.errors.length).toBeGreaterThanOrEqual(expectCodes.length);
    };

    check('version: 2\nextensions: []\n', [EXT_VERSION]);
    check('version: 1\n', [EXT_INVALID]);
    check('version: 1\nextensions:\n  - target: "functions.user_service"\n    patch: "not-an-object"\n', [EXT_INVALID]);
    check('version: 1\nextensions:\n  - target: "functions/user_service"\n    patch: {}\n', [EXT_INVALID]);
    check('version: 1\nextensions:\n  - target: "Functions.user_service"\n    patch: {}\n', [EXT_INVALID]);
    check('version: 1\nextensions:\n  - target: "functions"\n    patch: {}\n', [EXT_INVALID]);
    check('version: 1\nextensions:\n  - target: "functions.user_service.extra"\n    patch: {}\n', [EXT_INVALID]);
    // collect-all: non-list `extensions` + bad `patch` in one file
    check(
      'version: 1\nextensions:\n  target: "functions.user_service"\n  patch: "not-an-object"\n',
      [EXT_INVALID, EXT_INVALID],
    );
    // duplicate YAML keys inside patch → parse gate EXT_INVALID
    check(
      'version: 1\nextensions:\n  - target: "functions.user_service"\n' +
        '    patch:\n      environment:\n        A: 1\n        A: 2\n',
      [EXT_INVALID],
    );
    // unknown top-level key → fail-fast EXT_INVALID
    check('version: 1\nextensions: []\nfoobar: 1\n', [EXT_INVALID]);
  });

  it('T087 Sc8: empty patch / empty list / new keys / missing file (US-8, FR-013/002, Sc8)', () => {
    const resources = canonicalResources();

    // (1) patch {} → no-op, configuration structurally equal
    const noOp = applyExtensions(resources, makeExtensions([rule('functions.user_service', {})]));
    expect(noOp.kind).toBe('ok');
    if (noOp.kind !== 'ok') return;
    const u = noOp.resources.find((r) => r.name === 'user_service')!;
    expect(u.configuration).toEqual(resources[0]!.configuration);

    // (2) extensions [] → identity transform, resources identical to input
    const identity = applyExtensions(resources, makeExtensions([]));
    expect(identity.kind).toBe('ok');
    if (identity.kind !== 'ok') return;
    resources.forEach((r, i) => expect(identity.resources[i]).toBe(r));

    // (3) new top-level key added
    const added = applyExtensions(resources, makeExtensions([rule('functions.user_service', { tags: { main: 'http' } })]));
    expect(added.kind).toBe('ok');
    if (added.kind !== 'ok') return;
    const addedTag = added.resources.find((r) => r.name === 'user_service')!;
    expect((addedTag.configuration as { tags: Record<string, unknown> }).tags).toEqual({ main: 'http' });

    // (4) missing file → loadExtensions throws EXT_MISSING_FILE
    project = createTempProject({});
    const root = project.root;
    expect(() => loadExtensions(root)).toThrow(/EXT_MISSING_FILE/);
  });

  it('T088 Sc9: deep merge edge-case table (US-2/8, FR-008, §25.2, Sc9)', () => {
    expect(deepMerge({ a: { list: [1, 2, 3] } }, { a: { list: [4] } })).toEqual({ a: { list: [4] } });
    expect(deepMerge({ a: null }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
    expect(deepMerge({ a: 'old' }, { a: null })).toEqual({ a: null });
    expect(deepMerge({ name: 'x' }, { custom_domains: [{ domain_id: 'd' }] })).toEqual({
      name: 'x',
      custom_domains: [{ domain_id: 'd' }],
    });
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });

    // immutability after every call
    const base = { a: { b: 1 }, list: [1, 2, 3] };
    const patch = { a: { c: 2 } };
    const baseBefore = JSON.stringify(base);
    const patchBefore = JSON.stringify(patch);
    const result = deepMerge(base, patch);
    expect(result).toEqual({ a: { b: 1, c: 2 }, list: [1, 2, 3] });
    expect(JSON.stringify(base)).toBe(baseBefore);
    expect(JSON.stringify(patch)).toBe(patchBefore);
  });

  it('T089 Sc10: defensive checks (FR-004/008/010, Sc10)', () => {
    // (1) duplicate IDL in generated model → defensive EXT_INVALID
    const dupResources = [
      functionResource('user_service', { name: 'a' }),
      functionResource('user_service', { name: 'b' }),
    ];
    const dup = applyExtensions(dupResources, makeExtensions([rule('functions.user_service', { tags: {} })]));
    expect(dup.kind).toBe('invalid');
    if (dup.kind !== 'invalid') return;
    expect(dup.errors[0]).toMatchObject({ code: EXT_INVALID });
    expect(dup.errors[0]?.message).toContain('duplicate IDL functions.user_service in generated model');

    // (2) targeted resource with non-object configuration → EXT_INVALID
    const nonObject = [
      functionResource('user_service', null as unknown as Record<string, unknown>),
      containerResource('frontend', { name: 'frontend' }),
    ];
    const bad = applyExtensions(nonObject, makeExtensions([rule('functions.user_service', { tags: {} })]));
    expect(bad.kind).toBe('invalid');
    if (bad.kind !== 'invalid') return;
    expect(bad.errors[0]).toMatchObject({ code: EXT_INVALID });

    // non-targeted non-object-configuration resources are NOT checked
    const notTargeted = [
      functionResource('user_service', { name: 'a' }),
      containerResource('frontend', null as unknown as Record<string, unknown>),
    ];
    const untargeted = applyExtensions(notTargeted, makeExtensions([rule('functions.user_service', { tags: { main: 'http' } })]));
    expect(untargeted.kind).toBe('ok');
    if (untargeted.kind !== 'ok') return;
    expect(untargeted.resources).toContain(notTargeted[1]);

    // (3) container (type outside table) present unchanged in ok result
    const resources = canonicalResources();
    const ok = applyExtensions(resources, makeExtensions([rule('functions.user_service', { tags: { env: 'prod' } })]));
    expect(ok.kind).toBe('ok');
    if (ok.kind !== 'ok') return;
    expect(ok.resources.find((r) => r.name === 'frontend')).toBe(resources[3]);

    // (4) rule with extra key → EXT_INVALID
    project = createTempProject({});
    writeExtensionsYaml(
      project,
      'version: 1\nextensions:\n  - target: "functions.user_service"\n    patch: {}\n    weight: 10\n',
    );
    const extra = loadExtensions(project.root);
    expect(extra.kind).toBe('invalid');
    if (extra.kind === 'ok') return;
    expect(extra.errors.some((e) => e.code === EXT_INVALID)).toBe(true);

    // (5) ${bad syntax in a patch value passes as a literal string (passthrough FR-010)
    const weird = applyExtensions(
      canonicalResources(),
      makeExtensions([rule('functions.user_service', { service_account_id: '${bad syntax' })]),
    );
    expect(weird.kind).toBe('ok');
    if (weird.kind !== 'ok') return;
    const w = weird.resources.find((r) => r.name === 'user_service')!;
    expect((w.configuration as { service_account_id: string }).service_account_id).toBe('${bad syntax');
  });

  it('T104 perf smoke: ~20 resources × ~10 rules completes fast (SC-001)', () => {
    const manyResources: readonly TerraformResource[] = [
      ...Array.from({ length: 10 }, (_, i) => functionResource(`fn_${i}`, { name: `fn-${i}` })),
      ...Array.from({ length: 10 }, (_, i) => containerResource(`c_${i}`, { name: `c-${i}` })),
    ];
    const manyRules = Array.from({ length: 10 }, (_, i) => rule(`functions.fn_${i}`, { tags: { index: String(i) } }));

    const start = performance.now();
    const result = applyExtensions(manyResources, makeExtensions(manyRules));
    const elapsed = performance.now() - start;

    expect(result.kind).toBe('ok');
    expect(elapsed).toBeLessThan(5000);
  });
});