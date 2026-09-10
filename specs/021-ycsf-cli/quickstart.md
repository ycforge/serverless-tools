# Quickstart: ycsf-cli (spec 021)

**Spec**: [specs/021-ycsf-cli/spec.md](./spec.md) | **Branch**: `021-ycsf-cli` | **Date**: 2026-09-10

Runnable validation scenarios (Sc1..ScN). Каждый сценарий доказывает конкретную часть feature end-to-end. Fixtures: `packages/pilot/test/check/fixtures/canonical/` ( canonical project с 2 apps, builders.yaml, extensions, outputs, moves).

---

## Prerequisites

```bash
cd packages/pilot
pnpm build          # build pilot + CLI
```

CLI binary: `packages/pilot/dist/cli/index.js` (#!/usr/bin/env node).

---

## Sc1: `ycsf build` на canonical fixture

**Fixture**: `test/check/fixtures/canonical/` (user_service, analytics)

```bash
node dist/cli/index.js build --project-dir test/check/fixtures/canonical
```

**Expected**: exit code 0, stderr содержит "Building app user_service...", "Building app analytics...", artifacts в `.ycsf/artifacts/`.

**Альтернативный запуск** (unit test approach):
```bash
pnpm vitest run test/cli/integration/build.integration.spec.ts
```

---

## Sc2: `ycsf build` с неизвестным --target

```bash
node dist/cli/index.js build --project-dir test/check/fixtures/canonical --target unknown_app
```

**Expected**: exit code 2, stderr содержит "CLI_APP_NOT_FOUND".

---

## Sc3: `ycsf check` на canonical fixture (clean)

```bash
node dist/cli/index.js check --project-dir test/check/fixtures/canonical
```

**Expected**: exit code 0, stdout "All checks passed."

---

## Sc4: `ycsf check` на missing-target fixture

**Fixture**: `test/check/fixtures/missing-target/`

```bash
node dist/cli/index.js check --project-dir test/check/fixtures/missing-target
```

**Expected**: exit code 1, stderr содержит "YCK_MISSING_TARGET" + "EXT_UNRESOLVED_TARGET".

---

## Sc5: `ycsf check --json` на canonical fixture

```bash
node dist/cli/index.js check --project-dir test/check/fixtures/canonical --json
```

**Expected**: exit code 0, stdout — валидный JSON:
```json
{
  "command": "check",
  "exitCode": 0,
  "diagnostics": [],
  "summary": { "total": 0 }
}
```

---

## Sc6: `ycsf plan` на canonical fixture (terraform mock)

**Fixture**: canonical fixture с mock terraform (scripts/mock-terraform.sh):

```bash
# Create mock terraform
cat > /usr/local/bin/terraform << 'EOF'
#!/bin/bash
echo "Terraform plan: 2 to add, 0 to change, 0 to destroy."
exit 0
EOF
chmod +x /usr/local/bin/terraform

node dist/cli/index.js plan --project-dir test/check/fixtures/canonical
```

**Expected**: exit code 0, stderr содержит build + materialize progress, stdout terraform plan output.

---

## Sc7: `ycsf plan` без terraform в PATH

```bash
PATH=/usr/bin:/bin node dist/cli/index.js plan --project-dir test/check/fixtures/canonical
```

**Expected**: exit code 1, stderr "CLI_TERRAFORM_NOT_FOUND".

---

## Sc8: `ycsf destroy` без --yes в non-TTY

```bash
echo "" | node dist/cli/index.js destroy --project-dir test/check/fixtures/canonical
```

**Expected**: exit code 2, stderr "CLI_DESTROY_REQUIRES_YES".

---

## Sc9: `ycsf destroy --yes` с mock terraform

```bash
cat > /usr/local/bin/terraform << 'EOF'
#!/bin/bash
echo "Terraform destroy: 2 destroyed."
exit 0
EOF
chmod +x /usr/local/bin/terraform

node dist/cli/index.js destroy --project-dir test/check/fixtures/canonical --yes
```

**Expected**: exit code 0, stderr terraform destroy output.

---

## Sc10: `ycsf --help`

```bash
node dist/cli/index.js --help
```

**Expected**: stdout содержит:
- Commands: build, materialize, check, plan, apply, destroy
- Global flags: --project-dir, --json, --no-color

---

## Sc11: `ycsf build --help`

```bash
node dist/cli/index.js build --help
```

**Expected**: stdout содержит build command description, flags: --project-dir, --target, --json.

---

## Sc12: `ycsf --version`

```bash
node dist/cli/index.js --version
```

**Expected**: stdout "1.0.0" (версия пакета pilot).

---

## Test mapping

| Scenario | Acceptance Criteria | Test Type |
|----------|-------------------|-----------|
| Sc1 | US1/AC1 | Integration (binary) |
| Sc2 | SC-008 | Integration (binary) |
| Sc3 | US3/AC1 | Integration (binary) |
| Sc4 | US3/AC2 | Integration (binary) |
| Sc5 | US7/AC1 | Integration (binary) |
| Sc6 | US4/AC1 | Integration (mock terraform) |
| Sc7 | SC-009 | Integration (binary) |
| Sc8 | SC-010 | Integration (binary) |
| Sc9 | US6/AC1 | Integration (mock terraform) |
| Sc10 | US8/AC1 | Integration (binary) |
| Sc11 | US8/AC2 | Integration (binary) |
| Sc12 | US8/AC3 | Integration (binary) |

---

## Test file structure

```text
packages/pilot/test/cli/
├── unit/
│   ├── errors.test.ts              # CLIError hierarchy, code→exitCode mapping
│   ├── pipeline.test.ts            # pipeline step sequencing (mocked)
│   └── terraform.test.ts           # spawnTerraform, ENOENT detection
├── integration/
│   ├── build.integration.spec.ts   # Sc1, Sc2
│   ├── materialize.integration.spec.ts # Sc1 (materialize step)
│   ├── check.integration.spec.ts   # Sc3, Sc4, Sc5
│   ├── plan.integration.spec.ts    # Sc6, Sc7
│   ├── apply.integration.spec.ts   # Sc9 (apply step)
│   ├── destroy.integration.spec.ts # Sc8, Sc9
│   └── help.integration.spec.ts    # Sc10, Sc11, Sc12
└── fixtures/
    └── (reuses test/check/fixtures/canonical/)
```
