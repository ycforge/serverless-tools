import { randomUUID } from 'node:crypto';

/** One per invocation (S-6, FR-019). */
export function newRequestId(): string {
  return randomUUID();
}