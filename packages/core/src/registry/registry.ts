import type { Exorcist, Extractor, FileKind } from '../types.ts';

export type Lazy<T extends { kind: FileKind }> = T | { kind: FileKind; load: () => Promise<T> };

export interface Registry {
  /** `undefined`: none registered. Rejects only if a lazy load fails (the orchestrator contains it). */
  extractor(kind: FileKind): Promise<Extractor | undefined>;
  exorcist(kind: FileKind): Promise<Exorcist | undefined>;
  kinds(): { extractors: FileKind[]; exorcists: FileKind[] };
}

export class RegistryError extends Error {
  constructor(readonly code: 'duplicate-kind' | 'unknown-kind-not-registrable', message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

export class LoadError extends Error {
  constructor(message: string) { super(message); this.name = 'LoadError'; }
}

function isLazy<T extends { kind: FileKind }>(e: Lazy<T>): e is { kind: FileKind; load: () => Promise<T> } {
  return typeof (e as { load?: unknown }).load === 'function';
}

function table<T extends { kind: FileKind }>(entries: Lazy<T>[], what: string) {
  const map = new Map<FileKind, Lazy<T>>();
  for (const e of entries) {
    if (e.kind === 'unknown') throw new RegistryError('unknown-kind-not-registrable', `${what} cannot be registered for kind 'unknown'`);
    if (map.has(e.kind)) throw new RegistryError('duplicate-kind', `two ${what}s registered for kind '${e.kind}'`);
    map.set(e.kind, e);
  }
  const pending = new Map<FileKind, Promise<T>>();
  return {
    kinds: () => [...map.keys()],
    get(kind: FileKind): Promise<T | undefined> {
      const e = map.get(kind);
      if (!e) return Promise.resolve(undefined);
      if (!isLazy(e)) return Promise.resolve(e);
      let p = pending.get(kind);
      if (!p) {
        p = e.load().then((v) => {
          if (!v || v.kind !== kind) throw new LoadError(`lazy ${what} for '${kind}' resolved to kind '${v?.kind}'`);
          return v;
        });
        // A failed load is forgotten so the next call retries (Requirement 3.5).
        p.catch(() => pending.delete(kind));
        pending.set(kind, p);
      }
      return p;
    },
  };
}

export function createRegistry(entries: { extractors: Lazy<Extractor>[]; exorcists: Lazy<Exorcist>[] }): Registry {
  const ex = table(entries.extractors, 'extractor');
  const xo = table(entries.exorcists, 'exorcist');
  return {
    extractor: (k) => ex.get(k),
    exorcist: (k) => xo.get(k),
    kinds: () => ({ extractors: ex.kinds(), exorcists: xo.kinds() }),
  };
}
