import type { Warning } from '../types.ts';

const MIB = 1024 * 1024;

/** Default budget: 2 s per MiB, at least 1 s, at most 120 s. Overrides must be integers in 1..600000. */
export function computeBudget(size: number, override?: number): { budgetMs: number; warning?: Warning } {
  const auto = Math.min(120_000, Math.max(1_000, Math.round((size / MIB) * 2_000)));
  if (override === undefined) return { budgetMs: auto };
  if (!Number.isInteger(override) || override < 1 || override > 600_000) {
    return { budgetMs: auto, warning: { code: 'invalid-option', message: `budgetMs must be an integer in 1..600000; using ${auto}` } };
  }
  return { budgetMs: override };
}

/** Combine a caller signal with a budget timer, without relying on AbortSignal.any. */
export function linkSignals(caller: AbortSignal | undefined, budgetMs: number) {
  const ctrl = new AbortController();
  let reason: 'budget' | 'caller' | null = null;
  const onCaller = () => { if (!reason) reason = 'caller'; ctrl.abort(); };
  if (caller?.aborted) onCaller();
  else caller?.addEventListener('abort', onCaller, { once: true });
  const timer = setTimeout(() => { if (!reason) reason = 'budget'; ctrl.abort(); }, budgetMs);
  return {
    signal: ctrl.signal,
    reason: () => reason,
    dispose() { clearTimeout(timer); caller?.removeEventListener('abort', onCaller); },
  };
}

/** Race `work` against the signal plus a grace period. Never rejects. */
export function withGrace<T>(work: Promise<T>, signal: AbortSignal, graceMs: number):
  Promise<{ status: 'done'; value: T } | { status: 'failed'; error: unknown } | { status: 'timeout' }> {
  return new Promise((resolve) => {
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: Parameters<typeof resolve>[0]) => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      signal.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const onAbort = () => { graceTimer = setTimeout(() => finish({ status: 'timeout' }), graceMs); };
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    work.then((value) => finish({ status: 'done', value }), (error) => finish({ status: 'failed', error }));
  });
}

/** Safe, short error description that never stringifies arbitrary objects (they may hold file bytes). */
export function describeError(e: unknown): string {
  try {
    if (e instanceof Error) return `${e.name}: ${String(e.message).slice(0, 200)}`;
    if (typeof e === 'string') return `Error: ${e.slice(0, 200)}`;
    return `Error: non-Error value of type ${typeof e}`;
  } catch {
    return 'Error: unreadable error';
  }
}
