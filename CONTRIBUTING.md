# Contributing to serverless-tools

Спасибо за интерес к проекту. Этот документ описывает, как устроена разработка в
репозитории `@ycforge/serverless-tools`.

> Перед первым вкладом обязательно прочитайте
> [`.specify/memory/constitution.md`](.specify/memory/constitution.md) —
> это непреложные принципы проекта. Спецификации и constitution имеют приоритет
> над этим документом.

## Требования

- **Node.js ≥ 22**
- **pnpm 11.22.0** (версия закреплена в `packageManager` корневого
  `package.json`; удобно через [Corepack](https://nodejs.org/api/corepack.html))
- **Terraform ≥ 1.5** — для сквозных проверок эталонного проекта
- **Docker** — только для тестов и сборок serverless-контейнеров

## Настройка окружения

```bash
corepack enable
pnpm install
pnpm -r build        # собрать dist всех пакетов
```

## Команды

| Команда | Что делает |
|---------|------------|
| `pnpm build` | Сборка всех пакетов монорепы (`pnpm -r build`) |
| `pnpm test` | Тесты всех пакетов (`pnpm -r test`) |
| `pnpm typecheck` | Проверка типов всех пакетов (`pnpm -r typecheck`) |
| `pnpm lint` | ESLint по репозиторию |

Перед открытием PR убедитесь, что проходят `pnpm build`, `pnpm test`,
`pnpm typecheck` и `pnpm lint`. Эти же команды прогоняются в CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Процесс разработки (SDD)

Проект ведётся по **Specification-Driven Development** на базе
[spec-kit](https://github.com/github/spec-kit):

- **Одна spec = один фокус = одна ветка.** Нет кода без утверждённой
  спецификации.
- **Test-first.** Acceptance criteria из spec превращаются в тесты до
  реализации: сначала RED, затем GREEN. Исключение (по constitution) — тонкие
  оркестрационные слои поверх Terraform CLI, для них допустимы характеризующие
  тесты после факта.
- **Явное вместо магии.** Коллизии (тип артефакта, путь/`operationId`,
  идентичность в `apps.yaml` и `resources.yaml`) — это ошибки, а не тихие
  слияния.
- При расхождении spec и [`IDEA.md`](IDEA.md) обновляется `IDEA.md` (specs
  первичны, constitution важнее обоих).

Цикл одной фичи:

```text
/speckit.specify → /speckit.clarify → /speckit.plan → /speckit.tasks
  → /speckit.analyze → /speckit.implement → /speckit.converge
```

- Roadmap и статусы спецификаций — в [`specs/README.md`](specs/README.md).
  Номера спецификаций не переиспользуются.
- Спецификации и `IDEA.md` — первичные артефакты, они коммитятся.
- `IDEA.md` читается точечно по разделам: `grep -n "^# 25\." IDEA.md`, затем
  `sed -n 'A,Bp' IDEA.md`. Читать файл целиком не нужно.

Для агентов и ассистентов правила работы зафиксированы в
[`AGENTS.md`](AGENTS.md). Команды spec-kit для opencode лежат в
`.opencode/commands/` и генерируются из `.kimi-code/skills/`:

```bash
node scripts/sync-opencode-commands.mjs
```

Не редактируйте `.opencode/commands/` вручную.

## Ветки и pull requests

- Любая новая работа (спека/фича) начинается с отдельной ветки **от `dev`**.
- Именование ветки совпадает с директорией спеки: `NNN-short-slug`, например
  `003-connector-require-auth`.
- По завершении: коммит → push → **PR в `dev`**. Прямой push в `dev`/`main`
  запрещён.
- В одном PR не должно быть двух спецификаций.
- Не забудьте обновить статус спецификации в `specs/README.md` (🚧 → ✅).

## Коммиты

- Сообщения коммитов — на английском, в стиле Conventional Commits
  (`feat(pilot): ...`, `fix(composer): ...`, `docs: ...`).
- Коммит должен быть сфокусированным; не смешивайте несвязанные изменения.
- Не коммитьте секреты и артефакты: `.ycsf/artifacts/`, `.env*`, Terraform state.
  Файл `.terraform.lock.hcl`, наоборот, коммитится.
- Не коммитьте сгенерированные `dist/` и `node_modules/`.

## Конвенции

- Спецификации и пользовательские документы — на русском; код, идентификаторы и
  сообщения коммитов — на английском.
- Типы артефактов именуются как `<scope>:<kind>`, например `ycforge:function`.
- Все форматы `.ycsf/*.yaml` содержат `version: 1` и покрыты версионированием
  контрактов `@ycforge/pilot/contracts` (semver; breaking change = major +
  migration guide).
- Контракты плагинов — только через subpath export `@ycforge/pilot/contracts`.
  Глубокие импорты внутренних модулей запрещены.

## Эталонный проект

[`examples/reference-project`](examples/reference-project) — канонический
end-to-end проект (четыре приложения). Изменения в пакетах, затрагивающие
конвейер сборки/деплоя, должны сохранять его зелёным:

```bash
pnpm -r build
pnpm --filter @ycforge/reference-project plan
```

## Вопросы

Если что-то в процессе не описано или противоречиво — открывайте issue; это
сигнал, что документ нужно дополнить.
