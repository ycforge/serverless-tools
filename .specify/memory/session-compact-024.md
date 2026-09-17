# Session compact — serverless-tools (opencode)

Компакт-план сессии: стабилизация тестов pilot, затем полный цикл specs 024.

## 1. Контекст

- Репозиторий: `git@github.com:ycforge/serverless-tools.git`, SDD/spec-kit.
- Сейчас: ветка `028-e2e-final-enablement`, PR #28 (CI был красным; фиксы уже запушены, CI зелёный).
- Прочитаны: `AGENTS.md`, `README.md`, `specs/README.md`, `.specify/memory/constitution.md` (в системном контексте).
- Spec 024 (`e2e-reference`): reference-проект (user_service + orders + frontend + openapi), build → terraform plan; статус ⬜; зависимости: все волны 1–3, 025, 026, 027.

## 2. Задачи (TODO)

1. Создать этот компакт (конец файла = основная инструкция от пользователя).
2. Изолировать/стабилизировать `cache.integration.spec.ts` и `build-apps.integration.spec.ts` — гонка на общих `.ycsf/{cache,artifacts}` canonical-фикстуры между параллельными spec-файлами. Решение: песочница через `mkdtemp` + `cp` canonical-фикстуры + `rm` сгенерированного состояния (шаблон `materialize-equivalence.spec.ts`). Проверено 6/6 прогонов pilot suite — зелёные.
3. Проверить `pnpm lint` и typecheck pilot; запушить на ветку 028.
4. Spec 024: поочерёдно запустить сабагентов `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement` → `/speckit.converge`.
5. Создать PR с реализацией 024 и смёрджить его (+ обновить `specs/README.md`).

## 3. Ожидаемый результат

- PR #28 (028) — зелёный CI, тесты изолированы.
- PR с реализацией spec 024 — создан и смёрджен.

---
## Основная инструкция (на которой следует держаться; приведена в конце, как указано)

«Давай. Сделай cache.integration.spec.ts, build-apps.integration.spec.ts изолированными и стабильными. После чего Прочитай AGENTS.md, README.md, specs/README.md и для таски 024 поочерёдно запускай сабагентов с /speckit.specify /speckit.plan /speckit.tasks /speckit.implement и /speckit.converge . В итоге должен получиться PR с реализацией 024, который ты смёрджишь. . Задачи запиши в TODO, следуй ему. А прежде всего сделай компакт. Не забудь в конце него написать вот это сообщение, как основное, которому следуешь.»