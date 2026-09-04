# AGENTS.md — @ycforge/serverless-tools

Guidance for AI coding agents working in this repository.

## What this repo is

This monorepo contains the **source code of the serverless-tools toolchain**, not a deployable application:

- `packages/nest-bridge` — Project A, runtime/transport adapter between Yandex Cloud Functions and plain NestJS apps (`@ycforge/nestjs-connector`; мигрирован из github.com/ycforge/ycsf-nestjs-connector v0.0.3);
- `packages/composer` — Project B, API Gateway / OpenAPI Composition Builder (`@ycforge/composer`);
- `packages/pilot` — Project C, Build/Deployment Orchestrator (`@ycforge/pilot`; Terraform is the only deployment engine).

Отдельного SDK-пакета нет: plugin contracts (Builder, Materializer, Artifact, TerraformResource, ResourceReference, OutputBuilder, diagnostics) являются частью публичного API pilot и экспортируются через subpath export `@ycforge/pilot/contracts` (type-only для авторов плагинов).

Core principle: **A owns runtime, B owns API composition, C owns orchestration/build, Terraform owns provisioning/deployment.** Never blur these boundaries.

## Required reading order

1. `.specify/memory/constitution.md` — non-negotiable principles (separation of concerns, spec-first/test-first, contract versioning, explicit-over-magic, ownership model). It supersedes feature specs.
2. `specs/README.md` — spec roadmap and current status.
3. The specific spec directory you are working on (`specs/NNN-*/`).
4. `IDEA.md` — architecture reference, **read selectively**: locate a section via `grep -n "^# N\." IDEA.md`, then read only that line range (e.g. `sed -n 'A,Bp' IDEA.md`). Do NOT read the whole file. Section numbers are stable.

## Development process (SDD / spec-kit)

- This project follows Specification-Driven Development. Spec-kit skills are installed in `.kimi-code/skills/` (source of truth). For **opencode**, the same commands are mirrored as custom commands in `.opencode/commands/speckit-*.md` (invoked as `/speckit-plan` etc.); regenerate them after any skill update with `node scripts/sync-opencode-commands.mjs`. Do not edit `.opencode/commands/` by hand.
- Feature cycle: `/speckit.specify` → (optional `/speckit.clarify`) → `/speckit.plan` → `/speckit.tasks` → `/speckit.analyze` → `/speckit.implement` → `/speckit.converge`.
- **No code without an approved spec.** One spec = one focus = one branch.
- **Test-first**: acceptance criteria from the spec become tests before implementation; confirm RED, then GREEN. Exception (per constitution): thin orchestration layers invoking the Terraform CLI may get characterization tests after the fact.
- Specs are written before implementation, not all upfront. Planned specs live as rows in `specs/README.md`; spec numbers are never reused.
- If a spec and `IDEA.md` diverge, update `IDEA.md` (specs win; constitution wins over both).

## Agent work loop (spec-to-spec handoff)

The feature cycle above covers ONE spec. The outer loop between specs is mandatory and works as follows:

1. **Finish**: after `/speckit.converge` reports Converged, merge the branch, then update the spec's status in `specs/README.md` (🚧 → ✅).
2. **Pick next**: from `specs/README.md`, select the lowest-numbered ⬜ spec whose dependencies are all ✅. If none are unblocked, stop and report to the user.
3. **Hand off**: start the next cycle with `/speckit.specify`, using the roadmap row (Scope column) plus any referenced prior specs as input. Set the new spec's status to 🚧 in the same commit as its creation.
4. **Never** work on two specs in one branch; never skip updating `specs/README.md` — it is the single source of truth for progress between sessions.

A new session always starts the same way: read constitution → read `specs/README.md` → continue the spec marked 🚧 (resume at its current phase) or pick the next ⬜ per step 2.

## Conventions

- Specs and user-facing docs: Russian; code, identifiers, commit messages: English (project artifacts follow existing file conventions).
- Clarification questions to the user in the spec-kit cycle (`/speckit-specify`, `/speckit-clarify`) MUST be asked in Russian.
- Package naming: artifact types use `<package-scope>:<kind>` (e.g. `ycforge:function`).
- All `.ycsf/*.yaml` formats carry `version: 1` and are covered by contract versioning of `@ycforge/pilot/contracts` (semver; breaking change = major + migration guide).
- Fail-fast over magic: collisions (artifact type, path/operationId, identity in both apps.yaml and resources.yaml) are errors, never silent merges.
- Canonical example project used across docs: apps `user_service`, `analytics`, `frontend`, `openapi` — keep examples consistent with it.

## Git

- `specs/` and `.specify/` are committed (specs are primary artifacts here).
- Do not commit `.ycsf/artifacts/`, `.env*`, Terraform state; commit `.terraform.lock.hcl`.
- **Branching**: any new work (feature/spec implementation) starts with a dedicated branch created **from `dev`**. On completion: commit to that branch, push it, and open a **PR into `dev`** — no direct pushes to `dev`/`main`.
- Branch naming: `NNN-short-slug` matching the spec directory (e.g. `003-connector-require-auth`).
