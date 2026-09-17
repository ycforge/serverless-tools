# @ycforge/serverless-tools

Yandex Cloud Serverless for NestJS.

Экосистема инструментов для запуска обычных NestJS-приложений (и не только) в Yandex Cloud Serverless-инфраструктуре — без превращения NestJS в отдельный framework.

> Эта монорепа — исходный код **инструментов** serverless-tools, а не деплоимое приложение.

## Пакеты

| Пакет | Кодовое имя | Назначение |
|-------|-------------|------------|
| `packages/nest-bridge` | Project A | `@ycforge/nestjs-connector`: runtime/transport adapter между Yandex Cloud Function и обычным NestJS-приложением (мигрирован из [ycforge/ycsf-nestjs-connector](https://github.com/ycforge/ycsf-nestjs-connector) v0.0.3; spec 003 добавил `@RequireAuth`, глобальный auth-guard и subpath exports `/auth`, `/queue`, `/context`) |
| `packages/composer` | Project B | `@ycforge/composer`: API Gateway / OpenAPI Composition Builder — собирает единую API Gateway specification из нескольких приложений |
| `packages/pilot` | Project C | `@ycforge/pilot`: Build/Deployment Orchestrator — сборка, builders, materializers, генерация Terraform; plugin contracts экспортируются через `@ycforge/pilot/contracts` |

Главный архитектурный принцип:

> **A отвечает за runtime, B — за API composition, C — за orchestration/build, Terraform — за provisioning/deployment.**

## Документация

- [`IDEA.md`](IDEA.md) — архитектурный документ (читать точечно по разделам, см. подсказку в `specs/README.md`);
- [`.specify/memory/constitution.md`](.specify/memory/constitution.md) — governing principles проекта;
- [`specs/README.md`](specs/README.md) — roadmap спецификаций (24 specs, волны 0–4);
- [`specs/`](specs/) — спецификации фичей (SDD, spec-kit).

## Процесс разработки

Разработка ведётся по **Specification-Driven Development** ([spec-kit](https://github.com/github/spec-kit)):

1. Спецификация первична: код пишется только из утверждённой spec;
2. Цикл на фичу: `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.analyze` → `/speckit.implement` → `/speckit.converge`;
3. Test-first: тесты генерируются из acceptance criteria до реализации;
4. При расхождении spec и IDEA.md обновляется IDEA.md.

## Текущий статус

- ✅ Spec 001: reverse-spec nest-bridge + gap-анализ против IDEA.md;
- 🚧 Spec 002: pilot-contracts — контракты плагинов `@ycforge/pilot/contracts` (требуется clarify 6 открытых вопросов);
- ⬜ Волны 1–4 по [`specs/README.md`](specs/README.md).
