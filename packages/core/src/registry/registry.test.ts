import { describe, expect, it, vi } from 'vitest';
import type { Extractor } from '../types.ts';
import { createRegistry, RegistryError } from './registry.ts';

const stub = (kind: Extractor['kind']): Extractor => ({ kind, detects: [], extract: async () => ({ ghosts: [], warnings: [], unchecked: [] }) });

describe('registry', () => {
  it('rejects duplicate kinds and the unknown kind at creation', () => {
    expect(() => createRegistry({ extractors: [stub('png'), stub('png')], exorcists: [] })).toThrow(RegistryError);
    expect(() => createRegistry({ extractors: [stub('unknown')], exorcists: [] })).toThrow(/unknown/);
  });
  it('loads a lazy entry once, even under concurrent first calls', async () => {
    const load = vi.fn(async () => stub('pdf'));
    const r = createRegistry({ extractors: [{ kind: 'pdf', load }], exorcists: [] });
    const [a, b] = await Promise.all([r.extractor('pdf'), r.extractor('pdf')]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('retries after a failed load and rejects a kind mismatch', async () => {
    let calls = 0;
    const r = createRegistry({ extractors: [{ kind: 'pdf', load: async () => { calls++; if (calls === 1) throw new Error('offline'); return stub('docx'); } }], exorcists: [] });
    await expect(r.extractor('pdf')).rejects.toThrow('offline');
    await expect(r.extractor('pdf')).rejects.toThrow(/resolved to kind 'docx'/);
    expect(calls).toBe(2);
  });
});
