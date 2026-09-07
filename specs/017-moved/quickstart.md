# Quickstart: moved — validation scenarios Sc1..ScN

Справочный проект (как во всех спеках): apps `user_service`, `analytics`, `frontend`, `openapi`. Dispatch (014) сгенерировал канонический набор ресурсов; current mapping (строит оркестратор 021 из dispatch-вывода, в тестах подаётся напрямую):

```text
functions.user_service      / yandex_function.user_service
functions.analytics        / yandex_function.analytics
gateways.openapi           / yandex_api_gateway.openapi
containers.frontend        / yandex_container.frontend        (idl-домен вне side-table 015; интересен только как 'чужой' idt)
```

**Предусловия**: `packages/pilot`, vitest (`pnpm --filter @ycforge/pilot test`); тесты RED → GREEN по Constitution II. `buildMoves`/`buildMovedFile` — чистые (без I/O); `loadMoves` без файла → `ok` c `moves: []`. Сериализация — переиспользуемый serializer 014 (`serializeJson`, sorted keys) через wrapper `buildMovedFile`.

---

## Sc1. Только idt меняется (rename Terraform-адреса) (US1, FR-012)

Current: `[{idl:'functions.users', idt:'yandex_function.user_api'}]`. moves:

```yaml
version: 1
moves:
  - from: {idl: functions.users, idt: yandex_function.users}
    to:   {idl: functions.users, idt: yandex_function.user_api}
```

**Ожидание**: `buildMoves` → `kind:'ok'`; `moved` ровно один: `[{kind:'moved', from:'yandex_function.users', to:'yandex_function.user_api'}]`.

**Сериализация (wrapper US1 AC2)**: `buildMovedFile(moved)` → `{filename:'moved.ycsf.tf.json', content}`; content = `{"moved": [{"from": "yandex_function.users", "to": "yandex_function.user_api"}]}` (валидный JSON, keys отсортированы — `from` < `to`). Файл совместим с `writeGeneratedTerraform` (014, без правок).

## Sc2. Полный rename (idl + idt) (US2, FR-012)

Current: `[{idl:'functions.user_service', idt:'yandex_function.user_service'}]`. moves: `from{f.users, yf.users} → to{f.user_service, yf.user_service}`.

**Ожидание**: `kind:'ok'`; `moved[0]` = `{from:'yandex_function.users', to:'yandex_function.user_service'}`; `to` равен **текущему** адресу из project model (не из истории) (US2 AC2).

## Sc3. Многошаговая цепочка (multi-hop) (US3, FR-009/FR-012)

Current: `[{idl:'functions.accounts', idt:'yandex_function.accounts'}]`. moves (из §35):

```yaml
moves:
  - from: {idl: functions.users, idt: yandex_function.users}
    to:   {idl: functions.user_service, idt: yandex_function.user_service}
  - from: {idl: functions.user_service, idt: yandex_function.user_service}
    to:   {idl: functions.accounts, idt: yandex_function.accounts}
```

**Ожидание**: `kind:'ok'`; `moved` = `[{from:'yandex_function.users', to:'yandex_function.accounts'}, {from:'yandex_function.user_service', to:'yandex_function.accounts'}]` — **хронологический порядок (старый адрес раньше)**.

**Детерминизм порядка записей (US9 AC4/FR-016)**: тот же набор цепочек с переставленными записями файла → тот же `moved` (канонический порядок цепочек по стартовому узлу, а не по порядку файла).

**Неполная история (US3 AC3)**: только шаг `users → accounts` в истории при терминале `accounts` текущем → `ok`, компилируется что есть (`{from:'yandex_function.users', to:'yandex_function.accounts'}`), ошибки нет.

## Sc4. Смена типа Terraform-ресурса — fail-fast (US4, FR-005/FR-013)

Current: `[{idl:'containers.users', idt:'yandex_container.users'}]`. moves: `from{f.users, yf.users} → to{c.users, yandex_container.users}`.

**Ожидание**: `kind:'invalid'`; errors содержит `MOV_TYPE_CHANGE` (первый сегмент `from.idt = yandex_function` ≠ `to.idt = yandex_container`).

**All-or-nothing (US4 AC2)**: тот же файл + ещё один валидный (moved-совместимый) шаг → НИ один `moved` не скомпилирован (collect-all + all-or-nothing).

## Sc5. Противоречивые bindings (US5, FR-006)

1. Два entry с одинаковым `from` `{f.users, yf.users}`, но разными `to` (`f.accounts/yf.accounts` и `f.analytics/yf.analytics`) → `invalid`, `MOV_CONTRADICTORY`.
2. Два entry с одинаковым `to` `{f.accounts, yf.accounts}`, но разными `from` → `invalid`, `MOV_CONTRADICTORY`.

**Ожидание**: ни silent merge, ни зависимости от порядка записей (Constitution V). **Дедуп/дубликаты**: полный дубликат entry (одинаковые from AND to) → `MOV_DUPLICATE` (не `MOV_CONTRADICTORY`).

## Sc6. Dangling история (US6, FR-010)

Current: `[{f.user_service, yf.user_service}]`. moves: `from{f.users, yf.users} → to{f.analytics, yf.analytics}` (терминал не в current).

**Ожидание**: `kind:'invalid'`; errors содержит `MOV_TARGET_UNRESOLVED` (терминал `f.analytics/yf.analytics` + available current идентичности алфавитно: `functions.user_service`) **и** `MOV_DANGLING` для каждого entry цепочки (здесь один). Для N-entry висячей цепочки — N `MOV_DANGLING` + 1 `MOV_TARGET_UNRESOLVED`.

## Sc7. idl-only миграция — no-op для Terraform (US7, FR-011)

1. Current `[{f.accounts, yf.users}]`, moves `from{f.users, yf.users} → to{f.accounts, yf.users}` → `kind:'ok'`, `moved === []` (адрес не менялся) (US7 AC1).
2. Цепочка с idl-only шагом внутри: `users→accounts` (идл-only, адрес X) + `accounts→reports` (X→Y), current `reports/Y` → `ok`, `moved` = `[{from:X, to:Y}]` — блок только для реально сменившегося адреса, `to` = финальный текущий (US7 AC2).

## Sc8. Optional файл / пусто / детерминизм (US9, FR-002/FR-016)

1. `loadMoves(rootDir)` без `.ycsf/moved.yaml` → `kind:'ok'`, `data.moves === []` (отсутствие файла — валидное состояние, НЕ ошибка).
2. `.ycsf/moved.yaml` c `moves: []` + любые current resources → `ok`, `moved === []`.
3. Два `buildMoves` с одинаковыми входами → глубоко равные результаты (детерминизм повторов).
4. Один и тот же набор цепочек в разном порядке записей → одинаковый `moved` (порядок — цепочки + хронология, не порядок файла).

## Sc9. Формат и грамматика (US8, FR-003/FR-004) — `loadMoves`/`parseMovesYaml`

| Файл / entry | Ожидание |
|--------------|----------|
| `version: 2` (+ moves) | `invalid`, `MOV_VERSION` |
| `version: 1` без ключа `moves` | `invalid`, `MOV_INVALID` (missing 'moves') |
| `from: {idl: functions, idt: yandex_function.users}` (1 сегмент idl) или `idl: "functions.user_service.extra"` (3 сегмента) | `invalid`, `MOV_INVALID` (IDL-грамматика) |
| `idt: "yandex-Function.users"` (дефис в типе) | `invalid`, `MOV_INVALID` (IDT-грамматика) |
| entry с `from` и `to` полностью идентичными (no-op) | `invalid`, `MOV_INVALID` |
| `from: {idl: A, idl: B, idt: Z}` (duplicate YAML key) | `invalid`, `MOV_INVALID` (parse-gate uniqueKeys, line/column) |
| Несколько структурных ошибок сразу | `invalid`, **все** errors собраны (collect-all) |
| Top-level неизвестный ключ `chains:` | `invalid`, `MOV_INVALID` (Constitution V) |

## Sc10. Defensive-проверки `buildMoves` (Edge Cases)

1. **Цикл** (`a→b`, `b→a`) → `invalid`, `MOV_CYCLE` (один на цикл).
2. **`moves: []`** → `ok`, `moved === []`.
3. **Грамматически невалидный endpoint в programmatic `MovesYaml`** (мимо loader, напр. из 020 check) → defensive `MOV_INVALID`.
4. **Несколько независимых цепочек**: каждая компилируется отдельно; порядок `moved` — канонический по стартовому узлу (детерминирован). Сериализация → один общий `moved.ycsf.tf.json`.
5. **`buildMovedFile([])`** → `null` (файл не пишется); stale `moved.ycsf.tf.json` из прошлого прогона убирает `writeGeneratedTerraform` (014) при следующем clean-прогоне.
6. **user `.tf` / provider state migrations**: `buildMoves` не читает и не пишет файлы, не запускает `terraform state mv` (FR-014, Constitution IV) — проверяется, что рядом лежащий user `.tf` не тронут.

## Как запускать

```bash
pnpm --filter @ycforge/pilot test          # все unit/quickstart/integration
pnpm --filter @ycforge/pilot typecheck     # типы (test/types/moves.test-d.ts)
pnpm lint                                  # lint repo
```

Test-first: каждый acceptance criterion spec 017 → минимум один тест (RED → GREEN). Fixture-хелперы — `test/helpers/moves-fixtures.ts` (по образцу `extensions-fixtures.ts`): фабрики `canonicalMovesYaml`, `endpoint()`, `entry()`, наборы current resources; loader I/O — `mkdtemp` (helper `temp-project.ts`). Контракт-зеркало сверяется статическим тестом: `contracts/moves.json` (#/errorCodes) ↔ `src/contracts/moves.ts`.

## Карта требование → сценарий

| Требование | Сценарий |
|------------|----------|
| FR-001/FR-002 optional файл + `moves: []` / missing | Sc8.1/8.2 |
| FR-003 `MOV_VERSION` | Sc9 |
| FR-004 `MOV_INVALID` (структура/грамматика/no-op, collect-all) | Sc9 |
| FR-005 `MOV_TYPE_CHANGE` | Sc4 |
| FR-006 `MOV_CONTRADICTORY` | Sc5 |
| FR-007 `MOV_DUPLICATE` | Sc5 |
| FR-008 `MOV_CYCLE` | Sc10.1 |
| FR-009 chain-связывание (`prev.to === next.from`) | Sc3 |
| FR-010 terminal resolution + `MOV_TARGET_UNRESOLVED`/`MOV_DANGLING` | Sc6 |
| FR-011 idl-only → no `moved` | Sc7 |
| FR-012 compile (исторические адреса, `to` = current, хронология) | Sc1, Sc2, Sc3 |
| FR-013 all-or-nothing | Sc4 |
| FR-014 чистый transform без I/O | Sc10.6 |
| FR-015 reuse `TerraformMoved` (002) | Sc1–3 |
| FR-016 детерминизм | Sc3, Sc8.3/8.4 |
| SC-001/SC-002 блоки + цепочки | Sc1–3 |
| SC-003 все-or-nothing type-change | Sc4 |
| SC-005 dangling не молчит | Sc6 |
| SC-006 idl-only не даёт no-op блок | Sc7 |
| SC-008 детерминизм | Sc8.3/8.4 |
| SC-010 100% AC покрыты тестами | все |

> Примечание: задачи тест-фикстур — `packages/pilot/test/moves/` (quickstart-интеграция) + `test/unit/{moves-yaml,validate,chain,build-moves}.spec.ts`. Walk по цепочкам и cycle-detection тестируются отдельно от loader-а. Loader (`loadMoves`) I/O-тесты — `mkdtemp`, отсутствие файла → ok c пустым `moves`.