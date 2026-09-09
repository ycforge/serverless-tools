import type { Artifact, MaterializationContext, Materializer } from '../types.js';

function notImplemented(): never {
  throw new Error('not implemented');
}

const materializer: Materializer = {
  supports(_artifact: Artifact, _context: MaterializationContext): boolean {
    return notImplemented();
  },
  async materialize(): Promise<never> {
    return notImplemented();
  },
};

export default materializer;