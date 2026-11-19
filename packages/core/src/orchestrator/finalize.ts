import { SEVERITY_ORDER, type Ghost, type GhostLocation, type Warning } from '../types.ts';

const SEV_RANK = new Map(SEVERITY_ORDER.map((s, i) => [s, i]));

/** Sort key for a location: [primary, secondary]. Nested locations sort by container first. */
export function locationSortKey(l: GhostLocation): (number | string)[] {
  switch (l.type) {
    case 'byte-range': case 'chunk': case 'pdf-revision': return [l.start];
    case 'pdf-region': return [l.page, -l.rect.y];
    case 'zip-entry': return [l.path];
    case 'nested': return [...locationSortKey(l.container), ...locationSortKey(l.inner)];
  }
}

function cmpKeys(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** Clamp confidence, sort by (severity, location, emission order) and assign `${kind}:${n}` ids. */
export function normalizeGhosts(ghosts: readonly Ghost[], warnings: Warning[]): Ghost[] {
  const withIndex = ghosts.map((g, i) => {
    let confidence = g.confidence;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      warnings.push({ code: 'invalid-confidence', message: `confidence ${String(confidence)} clamped for ${g.kind}` });
      confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
    }
    return { g: { ...g, confidence }, i };
  });
  withIndex.sort((a, b) =>
    (SEV_RANK.get(a.g.severity) ?? 9) - (SEV_RANK.get(b.g.severity) ?? 9)
    || cmpKeys(locationSortKey(a.g.location), locationSortKey(b.g.location))
    || a.i - b.i);
  const counters = new Map<string, number>();
  return withIndex.map(({ g }) => {
    const n = counters.get(g.kind) ?? 0;
    counters.set(g.kind, n + 1);
    return { ...g, id: `${g.kind}:${n}` };
  });
}
