/**
 * Spec 002 canonical parser re-export (FR-005; Constitution I). The composer
 * does NOT reimplement `domain.name.property` parsing — `parseResourceReference`
 * from `@ycforge/pilot/contracts` is the single canonical parser.
 */
export {
  parseResourceReference,
  formatResourceReference,
  type ParsedResourceReference,
  type ResourceReference,
} from '@ycforge/pilot/contracts';