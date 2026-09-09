import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiGatewayArtifactValue, Artifact, MaterializationContext, Materializer, ResourceReference, TerraformResource } from '../types.js';
import { YMT_INVALID_ARTIFACT_VALUE, materializerError } from '../diagnostics.js';
import { replaceResourceRefs } from './ref-resolver.js';

const materializer: Materializer = {
  supports(artifact, _context: MaterializationContext): boolean {
    return artifact.type === 'ycforge:api-gateway';
  },
  async materialize(artifact, context) {
    const value = artifact.value as ApiGatewayArtifactValue;
    const { specPath, resourceReferences = [] } = value;

    if (!specPath) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: specPath');
    }

    const specContent = readFileSync(specPath, 'utf8');
    const resolved = replaceResourceRefs(specContent, resourceReferences as readonly ResourceReference[]);

    const name = (artifact as { name?: string }).name ?? 'unknown';
    const companionDir = resolve(process.cwd(), 'generated');
    mkdirSync(companionDir, { recursive: true });
    const companionPath = resolve(companionDir, `${name}-openapi.yaml`);
    writeFileSync(companionPath, resolved, 'utf8');

    const resource: TerraformResource = {
      kind: 'resource',
      type: 'yandex_api_gateway',
      name,
      configuration: {
        spec: `file("\${path.module}/generated/${name}-openapi.yaml")`,
      },
    };

    context.output.declare(`${name}_gateway_id`, {
      value: `yandex_api_gateway.${name}.id`,
    });

    return resource;
  },
};

export default materializer;