import { describe, expect, it } from 'vitest';

import type {
  Artifact,
  MaterializationContext,
  Materializer,
  OutputBuilder,
  TerraformResource,
} from '../../src/contracts/index.js';

// User Story 2 independent test: a reference materializer is exercised with
// a mock MaterializationContext. supports selects by artifact.type,
// materialize returns a TerraformResource, and output.declare captures a
// Terraform expression WITHOUT the ${...} wrapper (FR-007).

interface FunctionArtifactValue {
  archivePath: string;
  entryPoint: string;
}

type FunctionArtifact = Artifact<FunctionArtifactValue>;

const functionMaterializer: Materializer<FunctionArtifact> = {
  supports(artifact: Artifact): boolean {
    return artifact.type === 'ycforge:function';
  },

  async materialize(artifact: FunctionArtifact): Promise<TerraformResource> {
    return {
      kind: 'resource',
      type: 'yandex_function',
      name: 'user_service',
      configuration: {
        entrypoint: artifact.value.entryPoint,
        artifacts: [{ type: 'zip', path: artifact.value.archivePath }],
      },
    };
  },
};

interface CapturedDeclare {
  name: string;
  output: { value: string; description?: string };
}

function mockContext(): { context: MaterializationContext; captured: CapturedDeclare[] } {
  const captured: CapturedDeclare[] = [];
  const output: OutputBuilder = {
    declare(name, output) {
      captured.push({ name, output });
    },
  };
  return { context: { output }, captured };
}

const artifact: FunctionArtifact = {
  type: 'ycforge:function',
  value: { archivePath: '/tmp/function.zip', entryPoint: 'index.handler' },
};

const foreignArtifact: Artifact = { type: 'ycforge:container', value: { image: 'x' } };

// View through the generic interface: supports must accept ANY artifact —
// C calls it with every artifact while dispatching (FR-014).
const genericMaterializer: Materializer = functionMaterializer;

describe('reference materializer (US2 independent test)', () => {
  it('supports selects strictly by artifact.type', () => {
    const { context } = mockContext();
    expect(genericMaterializer.supports(artifact, context)).toBe(true);
    expect(genericMaterializer.supports(foreignArtifact, context)).toBe(false);
  });

  it('materialize resolves to a TerraformResource with kind/type/name', async () => {
    const { context } = mockContext();
    const resource = await functionMaterializer.materialize(artifact, context);
    expect(resource.kind).toBe('resource');
    expect(resource.type).toBe('yandex_function');
    expect(resource.name.length).toBeGreaterThan(0);
  });

  it('output.declare captures a Terraform expression without ${...} (FR-007)', () => {
    const { context, captured } = mockContext();
    context.output.declare('ycsf_function_user_service_id', {
      value: 'yandex_function.user_service.id',
      description: 'serverless-tools generated: functions.user_service.id',
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.name).toBe('ycsf_function_user_service_id');
    expect(captured[0]?.output.value).toBe('yandex_function.user_service.id');
    expect(captured[0]?.output.value).not.toContain('${');
  });
});
