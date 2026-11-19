import { carries, sortCanonical } from '../ghost-kinds.ts';
import type { FileKind, GhostKind } from '../types.ts';

/** unchecked = (carries \ detects) ∪ (reported ∩ carries) ∪ forced, deduped, canonical order. */
export function computeUnchecked(args: {
  kind: FileKind; detects: readonly GhostKind[]; reported: readonly GhostKind[]; forced: readonly GhostKind[];
}): GhostKind[] {
  const c = new Set(carries(args.kind));
  const detects = new Set(args.detects);
  const out: GhostKind[] = [];
  for (const k of c) if (!detects.has(k)) out.push(k);
  for (const k of args.reported) if (c.has(k)) out.push(k);
  out.push(...args.forced);
  return sortCanonical(out);
}
