import type { Ghost, GhostLocation, Inspection } from './types.ts';

export interface NestedGhostRaw { innerGhost: Ghost }

/** Wrap an inner inspection's ghosts as `embedded-media-ghost`s located inside `container`. */
export function nestGhosts(inner: Inspection, container: GhostLocation): Ghost[] {
  return inner.ghosts.map((g) => ({
    id: g.id,
    kind: 'embedded-media-ghost' as const,
    severity: g.severity,
    title: `Inside an embedded ${inner.kind.toUpperCase()}: ${g.title}`,
    explanation: g.explanation,
    location: { type: 'nested', container, inner: g.location, innerKind: inner.kind },
    evidence: { ...g.evidence, raw: { innerGhost: g } satisfies NestedGhostRaw },
    confidence: g.confidence,
  }));
}

export function isNestedGhostRaw(raw: unknown): raw is NestedGhostRaw {
  return typeof raw === 'object' && raw !== null && 'innerGhost' in raw;
}
