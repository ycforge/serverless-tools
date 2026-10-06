# @ycforge/builders-core

Core builder plugins for the serverless-tools ecosystem (spec 018): `nestjs-function`
(bundling), `docker`, `vite`. Registered via the spec-013 explicit mapping under
subpath specifiers `@ycforge/builders-core/{nestjs-function,docker,vite}`.

## nestjs-function builder

App-level `build_config`:

```yaml
# .ycsf/<appId>/build_config.yaml
build_config:
  entry: src/main.ts      # default: src/main.ts
  runtime: nodejs22       # nodejs20 | nodejs22, default nodejs20
  external: []            # bare runtime requires kept out of the bundle
  out_filename: function.zip
```

The builder bundles the entry and its local imports into one self-contained CJS
file and zips it into the app output directory, returning
`{ type: 'ycforge:function', value: { archivePath, entryPoint } }`.

### Optional Nest integrations need no manual aliases/externals

Nest loads optional integrations with runtime `require()` guards
(`@nestjs/microservices`, `@nestjs/websockets`, `@nestjs/platform-express`,
`class-transformer/storage`, `class-validator`). esbuild would otherwise try to
resolve them (and their own optional transports) and fail. The builder
substitutes empty stubs for these imports automatically, so a plain NestJS
function bundles without `--alias`/`--external` flags:

```bash
ycsf build   # no esbuild aliases required
```

Declared `external` entries are the opposite: they stay a bare `require` in the
bundle and are the deployment's responsibility, never vendored.

### NestJS constructor DI (decorator metadata)

esbuild implements TypeScript decorators but **not** `emitDecoratorMetadata`,
which needs type information — bundling a NestJS app with esbuild alone strips
`design:paramtypes` and breaks constructor injection. The builder therefore
transpiles every `.ts`/`.tsx` file through SWC (`legacyDecorator` +
`decoratorMetadata`) before esbuild bundles it, so class-token DI keeps working
exactly as in a `tsc`-compiled app. `@swc/core` is a runtime dependency of this
package for that reason.

## docker builder

App-level `build_config` (versionless, spec 011):

```yaml
# .ycsf/<appId>/build_config.yaml
build_config:
  image:
    repository: cr.yandex/crp/analytics
    tag: v1
    no_push: false   # optional, default false
  dockerfile: Dockerfile
```

The builder always resolves a content-addressable digest and produces
`{ type: 'ycforge:docker-image', value: { image: "<repository>@sha256:<hex64>" } }`
— the image string is an immutable digest form; a mutable tag never appears in the
artifact value.

### `image.no_push` — local-only build (spec 027)

`image.no_push: true` runs `docker build` into the local daemon **without** calling
`docker push`. The digest is read back from the local image via
`docker image inspect --format '{{.Id}}'`; no registry access and no credentials are
required. `BLC_IMAGE_DIGEST_UNAVAILABLE` / `BLC_BUILD_FAILED` are reported fail-fast
when the CLI, daemon, or local digest is unavailable — never a silent success.

Limitations (intentional, see spec 027 A-2/NG-8):

- The no-push digest is the **local image ID** (`{{.Id}}`), which is deterministic
  for identical inputs but is **not guaranteed to equal** the manifest digest a
  registry would produce after a real push.
- A no-push artifact is **not guaranteed to be pullable** from any registry until a
  real push of that context happens.
- Publishing is a separate, deliberate step (a later `docker push` by whoever holds
  credentials); this option does not push and does not substitute a registry.

`no_push` defaults to `false`; the default behavior is unchanged: build → push →
digest → artifact.

### `image.mode` — docker dev-modes (spec 028)

The `image` block accepts an optional dev-mode selector for environments where a
local docker daemon is not available:

```yaml
build_config:
  image:
    mode: registry-ref   # | remote
    ref: cr.yandex/crp/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    host: unix:///var/run/docker.sock   # remote builds only
  dockerfile: Dockerfile
```

- `mode: registry-ref` — **no docker CLI invocation at all**: the supplied
  `image.ref` (immutable digest form, `/^[^@]+@sha256:[0-9a-f]{64}$/`) becomes the
  artifact value verbatim. A mutable tag or `repository:tag`-style ref is rejected
  with `BLC_INVALID_CONFIG` — the "never a mutable tag" invariant is preserved.
- `mode: remote` — build (and push unless `no_push: true`) runs against the daemon
  at `image.host` (`DOCKER_HOST` passthrough); the digest is read from that same
  daemon.
- **Unreachable daemon is never a silent fallback**: any default-/remote-mode build
  that cannot reach the daemon fails with `BLC_DOCKER_UNREACHABLE` and an
  actionable message (start the daemon, or switch to `mode: registry-ref` /
  `mode: remote`).

`mode` is absent by default → local-daemon build + push (spec 027 `no_push`
semantics preserved in every mode).