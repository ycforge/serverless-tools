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

## Development process

- **Specs are the source of truth.** Every change starts by writing or updating a spec under `specs/NNN-<slug>/spec.md` (Russian) and registering/updating its row in `specs/README.md`. One spec = one focus = one branch.
- **Spec-kit is legacy.** The former SDD tooling — `.kimi-code/skills/speckit-*`, `.opencode/commands/speckit-*.md`, `/speckit.*` commands, `scripts/sync-opencode-commands.mjs`, and `.specify/scripts|templates|workflows` — is no longer used: do not invoke it, regenerate it, or edit it. `specs/` stays in place; `.specify/memory/constitution.md` still holds the non-negotiable principles.
- **Test-first**: acceptance criteria from the spec become tests before implementation; confirm RED, then GREEN. Exception (per constitution): thin orchestration layers invoking the Terraform CLI may get characterization tests after the fact.
- Specs are written before implementation, not all upfront. Spec numbers are never reused.
- If a spec and `IDEA.md` diverge, update `IDEA.md` (specs win; constitution wins over both).
- Keep `specs/README.md` in sync with reality: a spec is 🚧 while its outcome is unverified, ✅ once verified and merged.

## Agent work loop

1. **Finish**: when the spec's outcome is verified, merge the branch (PR into `dev`) and set its status in `specs/README.md` to ✅.
2. **Pick next**: follow the user's current directive; otherwise take the lowest-numbered ⬜ spec whose dependencies are all ✅.
3. **Hand off**: write the new spec directory + roadmap row (status 🚧) in the same commit as its creation.
4. **Never** work on two specs in one branch; never skip updating `specs/README.md` — it is the single source of truth for progress between sessions.

A new session starts by reading `specs/README.md` and continuing the spec marked 🚧 (or the user's current directive).

## Conventions

- Specs and user-facing docs: Russian; code, identifiers, commit messages: English (project artifacts follow existing file conventions).
- Clarification questions to the user MUST be asked in Russian and MUST be illustrated with concrete examples: a small end-to-end scenario (who does what, ideally with a tiny code/config snippet and the observable outcome), not just abstract trade-off descriptions. If a question hinges on a boundary between components or on a CONSTITUTION/IDEA rule, show the concrete flow under each proposed option and what goes wrong under the rejected ones.
- Package naming: artifact types use `<package-scope>:<kind>` (e.g. `ycforge:function`).
- All `.ycsf/*.yaml` formats carry `version: 1` and are covered by contract versioning of `@ycforge/pilot/contracts` (semver; breaking change = major + migration guide).
- Fail-fast over magic: collisions (artifact type, path/operationId, identity in both apps.yaml and resources.yaml) are errors, never silent merges.
- Canonical example project used across docs: apps `user_service`, `analytics`, `frontend`, `openapi` — keep examples consistent with it.

## Yandex Cloud CLI

- **Use only the `ycforge-sa` profile** (`yc --profile ycforge-sa` / `YC_PROFILE=ycforge-sa`) — this is always allowed.
- **Any other profile (including `default`) requires the user's explicit, per-use permission.** Never reuse a previously granted permission for further commands; ask again each time.

## Git

- `specs/` is committed and is the primary artifact; `.specify/` is legacy spec-kit scaffolding (only `.specify/memory/constitution.md` is still referenced).
- Do not commit `.ycsf/artifacts/`, `.env*`, Terraform state; commit `.terraform.lock.hcl`.
- **Branching**: any new work (feature/spec implementation) starts with a dedicated branch created **from `dev`**. On completion: commit to that branch, push it, and open a **PR into `dev`** — no direct pushes to `dev`/`main`.
- Branch naming: `NNN-short-slug` matching the spec directory (e.g. `003-connector-require-auth`).
