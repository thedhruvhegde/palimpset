/**
 * Public API of @palimpsest/core.
 * Built from .kiro/specs/ghost-model-and-ingest and .kiro/specs/image-ghosts.
 */
import { inspectWith, isVerifiedClean } from './orchestrator/inspect.ts';
import { defaultRegistry } from './registry/default.ts';
import type { Registry } from './registry/registry.ts';
import type { Inspection, InspectOptions } from './types.ts';

export * from './types.ts';
export { sniff, sniffDetailed } from './formats/sniff.ts';
export { nestGhosts, isNestedGhostRaw } from './nested.ts';
export { CARRIES, carries } from './ghost-kinds.ts';
export { createRegistry, RegistryError, type Registry, type Lazy } from './registry/registry.ts';
export { InspectionSchema, GhostSchema } from './schema.ts';
export { isVerifiedClean };

/** Inspect a file's bytes. Never rejects. */
export function inspect(bytes: Uint8Array, opts?: InspectOptions): Promise<Inspection> {
  return inspectWith(defaultRegistry, bytes, opts);
}

/** Bind inspect to a custom registry (tests, the Paw, hosts with extra formats). */
export function createCore(registry: Registry) {
  return { inspect: (bytes: Uint8Array, opts?: InspectOptions) => inspectWith(registry, bytes, opts) };
}
