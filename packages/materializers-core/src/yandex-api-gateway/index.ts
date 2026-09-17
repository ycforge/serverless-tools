import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiGatewayArtifactValue, MaterializationContext, Materializer, ResourceReference, TerraformResource } from '../types.js';
import { YMT_INVALID_ARTIFACT_VALUE, materializerError } from '../diagnostics.js';
import { isTfAddress, toYcResourceName } from '../helpers/filename.js';
import { buildGatewayTemplate } from './ref-resolver.js';

const materializer: Materializer = {
  supports(artifact, _context: MaterializationContext): boolean {
    return artifact.type === 'ycforge:api-gateway';
  },
  async materialize(artifact, context) {
    if (artifact.value === undefined) {
      throw materializerError(
        YMT_INVALID_ARTIFACT_VALUE,
        `built artifact value is missing for app '${artifact.name ?? 'unknown'}' — run \`ycsf build\` first or pass \`--artifacts <dir>\``,
      );
    }
    const value = artifact.value as ApiGatewayArtifactValue;
    const { specPath, resourceReferences = [] } = value;

    if (!specPath) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: specPath');
    }

    const specContent = readFileSync(specPath, 'utf8');
    const template = buildGatewayTemplate(specContent, resourceReferences as readonly ResourceReference[]);

    if (typeof artifact.name !== 'string' || !isTfAddress(artifact.name)) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: name (stable app identity)');
    }
    const name = artifact.name;

    // spec 028 (T020/T023): the OpenAPI companion is written next to the
    // infrastructure, root-relative, when the pipeline hands projectRoot down
    // (terraform cwd = `infra` → `${path.module}` = `infra`, so the reference
    // resolves). Without it we keep the legacy cwd-relative behavior.
    const companionDir =
      context.projectRoot !== undefined
        ? resolve(context.projectRoot, 'infra', 'generated')
        : resolve(process.cwd(), 'generated');
    mkdirSync(companionDir, { recursive: true });
    const companionPath = resolve(companionDir, `${name}-openapi.yaml`);
    writeFileSync(companionPath, template.content, 'utf8');

    // Terraform `templatefile` substitutes the `${terraformType_name_property}`
    // placeholders in the companion YAML with the REAL sibling-resource
    // attributes at APPLY time (spec content is raw text — a literal
    // `${yandex_function.x.id}` would never render). The whole call is wrapped
    // in `${...}` so Terraform evaluates `templatefile(...)`/`file(...)` as an
    // expression instead of feeding the provider the literal call text. No
    // references → plain `file(...)` (stateless spec, e.g. an authorizer-only
    // gateway).
    const specPart =
      Object.keys(template.variableMap).length === 0
        ? `\${file("\${path.module}/generated/${name}-openapi.yaml")}`
        : `\${templatefile("\${path.module}/generated/${name}-openapi.yaml", { ${Object.entries(template.variableMap)
            .map(([key, address]) => `${key} = ${address}`)
            .join(', ')} })}`;

    const resource: TerraformResource = {
      kind: 'resource',
      type: 'yandex_api_gateway',
      name,
      configuration: {
        name: toYcResourceName(name),
        spec: specPart,
      },
    };

    context.output.declare(`${name}_gateway_id`, {
      value: `yandex_api_gateway.${name}.id`,
    });

    return resource;
  },
};

export default materializer;