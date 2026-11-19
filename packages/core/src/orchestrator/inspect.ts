import { carries, GHOST_KINDS, sortCanonical } from '../ghost-kinds.ts';
import { sniffDetailed } from '../formats/sniff.ts';
import type { Registry } from '../registry/registry.ts';
import { ExtractResultSchema } from '../schema.ts';
import type { ExtractContext, FileKind, GhostKind, Inspection, InspectOptions, Warning } from '../types.ts';
import { computeBudget, describeError, linkSignals, withGrace } from './budget.ts';
import { normalizeGhosts } from './finalize.ts';
import { computeUnchecked } from './unchecked.ts';

export const MAX_DEPTH = 3;
export const MAX_SIZE = 200 * 1024 * 1024;
const GRACE_MS = 250;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function done(kind: FileKind, size: number, t0: number, partial: Partial<Inspection>): Inspection {
  return {
    kind, size,
    ghosts: partial.ghosts ?? [],
    warnings: partial.warnings ?? [],
    unchecked: partial.unchecked ?? [...carries(kind)],
    durationMs: Math.max(0, now() - t0),
  };
}

/**
 * Inspect `bytes` with `registry`. Never rejects (G5), always honest about what wasn't checked (G6).
 * `parentSignal` is used for nested calls so a whole tree shares one budget.
 */
export async function inspectWith(
  registry: Registry, bytes: Uint8Array, opts: InspectOptions = {}, depth = 0, parentSignal?: AbortSignal,
): Promise<Inspection> {
  const t0 = now();
  if (!(bytes instanceof Uint8Array)) {
    return done('unknown', 0, t0, { warnings: [{ code: 'invalid-input', message: 'input is not a Uint8Array' }], unchecked: [...GHOST_KINDS] });
  }
  const { kind, reason } = sniffDetailed(bytes);
  const size = bytes.byteLength;
  const warnings: Warning[] = [];

  if ((parentSignal ?? opts.signal)?.aborted) return done(kind, size, t0, { warnings: [{ code: 'aborted', message: 'aborted before start' }] });
  if (size > MAX_SIZE) return done(kind, size, t0, { warnings: [{ code: 'file-too-large', message: `file is larger than ${MAX_SIZE} bytes` }] });
  if (kind === 'unknown') {
    return done(kind, size, t0, { warnings: [{ code: 'unsupported-format', message: `unsupported or unrecognized format (${reason})` }], unchecked: [...GHOST_KINDS] });
  }

  let extractor;
  try {
    extractor = await registry.extractor(kind);
  } catch (e) {
    return done(kind, size, t0, { warnings: [{ code: 'extractor-load-failed', message: describeError(e) }] });
  }
  if (!extractor) return done(kind, size, t0, { warnings: [{ code: 'no-extractor', message: `no extractor registered for ${kind}` }] });

  const allowed = new Set(carries(kind));
  if (extractor.detects.some((k) => !allowed.has(k))) {
    warnings.push({ code: 'detects-exceeds-carries', message: `${kind} extractor declares kinds this format cannot carry` });
  }

  const budget = depth === 0 ? computeBudget(size, opts.budgetMs) : undefined;
  if (budget?.warning) warnings.push(budget.warning);
  const link = parentSignal ? undefined : linkSignals(opts.signal, budget!.budgetMs);
  const signal = parentSignal ?? link!.signal;

  const forced: GhostKind[] = [];
  const nestedRuns: Inspection[] = [];
  const ctx: ExtractContext = {
    signal,
    depth,
    adapters: opts.adapters ?? {},
    inspectNested: async (inner) => {
      let r: Inspection;
      if (depth + 1 > MAX_DEPTH) {
        const innerKind = sniffDetailed(inner).kind;
        r = done(innerKind, inner.byteLength, now(), { warnings: [{ code: 'max-depth', message: `nesting deeper than ${MAX_DEPTH} levels was not inspected` }] });
      } else {
        r = await inspectWith(registry, inner, opts, depth + 1, signal);
      }
      nestedRuns.push(r);
      return r;
    },
  };

  const outcome = await withGrace(Promise.resolve().then(() => extractor.extract(bytes, ctx)), signal, GRACE_MS);
  const abortReason = link?.reason() ?? (signal.aborted ? 'caller' : null);
  link?.dispose();

  for (const n of nestedRuns) {
    for (const w of n.warnings) warnings.push({ ...w, code: `nested:${w.code}` });
    if (n.warnings.length) forced.push('embedded-media-ghost');
  }

  if (outcome.status === 'timeout') {
    warnings.push({ code: abortReason === 'caller' ? 'aborted' : 'budget-exceeded', message: 'inspection stopped before the extractor finished' });
    return done(kind, size, t0, { warnings });
  }
  if (outcome.status === 'failed') {
    warnings.push({ code: 'extractor-crashed', message: describeError(outcome.error).slice(0, 300) });
    return done(kind, size, t0, { warnings, unchecked: sortCanonical([...extractor.detects, ...carries(kind).filter((k) => !extractor.detects.includes(k)), ...forced]) });
  }
  const parsed = ExtractResultSchema.safeParse(outcome.value);
  if (!parsed.success) {
    warnings.push({ code: 'extractor-invalid-result', message: 'extractor returned a result that does not match the ghost model' });
    return done(kind, size, t0, { warnings, unchecked: sortCanonical([...carries(kind), ...forced]) });
  }

  const result = outcome.value;
  warnings.push(...result.warnings);
  const ghosts = normalizeGhosts(result.ghosts, warnings);
  let unchecked = computeUnchecked({ kind, detects: extractor.detects, reported: result.unchecked, forced });
  if (abortReason) {
    warnings.push({ code: abortReason === 'caller' ? 'aborted' : 'budget-exceeded', message: 'inspection was cut short; results are partial' });
    unchecked = sortCanonical([...carries(kind), ...forced]);
  }
  return { kind, size, ghosts, warnings, unchecked, durationMs: Math.max(0, now() - t0) };
}

const NOT_CLEAN = new Set(['aborted', 'budget-exceeded', 'extractor-crashed', 'file-too-large', 'max-depth']);

/** True only when nothing was found AND everything was checked. */
export function isVerifiedClean(i: Inspection): boolean {
  return i.ghosts.length === 0 && i.unchecked.length === 0 && i.kind !== 'unknown'
    && !i.warnings.some((w) => NOT_CLEAN.has(w.code) || NOT_CLEAN.has(w.code.replace(/^(nested:)+/, '')));
}
