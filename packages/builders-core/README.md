# @ycforge/builders-core

Core builder plugins for the serverless-tools ecosystem (spec 018): `nestjs-function`
(bundling), `docker`, `vite`. Registered via the spec-013 explicit mapping under
subpath specifiers `@ycforge/builders-core/{nestjs-function,docker,vite}`.

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