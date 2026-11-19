import { describe, expect, it } from 'vitest';
import { GHOST_KINDS, type Extractor, type Ghost } from '../types.ts';
import { carries } from '../ghost-kinds.ts';
import { createRegistry } from '../registry/registry.ts';
import { makePng } from '../../test-support/builders.ts';
import { inspectWith, isVerifiedClean } from './inspect.ts';

const png = makePng();
const ghost = (over: Partial<Ghost> = {}): Ghost => ({
  id: 'x', kind: 'gps-location', severity: 'wraith', title: 't', explanation: 'e',
  location: { type: 'byte-range', start: 0, end: 1 }, evidence: { summary: 's' }, confidence: 1, ...over,
});
const reg = (e: Partial<Extractor>) => createRegistry({ extractors: [{ kind: 'png', detects: ['gps-location'], extract: async () => ({ ghosts: [], warnings: [], unchecked: [] }), ...e }], exorcists: [] });

describe('inspect orchestrator', () => {
  it('is honest about unknown formats (G6)', async () => {
    const r = await inspectWith(reg({}), new Uint8Array([1, 2, 3]));
    expect(r.kind).toBe('unknown');
    expect(r.unchecked).toEqual([...GHOST_KINDS]);
    expect(r.warnings[0]?.code).toBe('unsupported-format');
    expect(isVerifiedClean(r)).toBe(false);
  });
  it('contains a crashing extractor (G5)', async () => {
    const r = await inspectWith(reg({ extract: () => { throw { secretBytes: [1, 2, 3] }; } }), png);
    expect(r.warnings.map((w) => w.code)).toContain('extractor-crashed');
    expect(r.warnings.find((w) => w.code === 'extractor-crashed')?.message).not.toContain('secretBytes');
    expect(r.unchecked).toContain('gps-location');
  });
  it('stops a hanging extractor at the budget', async () => {
    const r = await inspectWith(reg({ extract: () => new Promise(() => {}) }), png, { budgetMs: 30 });
    expect(r.warnings.map((w) => w.code)).toContain('budget-exceeded');
    expect(r.unchecked).toEqual([...carries('png')]);
  });
  it('sorts by severity and assigns per-kind ids', async () => {
    const r = await inspectWith(reg({ detects: ['gps-location', 'capture-time'], extract: async () => ({
      ghosts: [ghost({ kind: 'capture-time', severity: 'wisp' }), ghost({ location: { type: 'byte-range', start: 9, end: 10 } }), ghost()],
      warnings: [], unchecked: [] }) }), png);
    expect(r.ghosts.map((g) => g.id)).toEqual(['gps-location:0', 'gps-location:1', 'capture-time:0']);
    expect(r.ghosts[0]!.location).toEqual({ type: 'byte-range', start: 0, end: 1 });
  });
  it('lists kinds the extractor does not detect as unchecked', async () => {
    const r = await inspectWith(reg({}), png);
    expect(r.unchecked).not.toContain('gps-location');
    expect(r.unchecked).toContain('trailing-data');
    expect(isVerifiedClean(r)).toBe(false);
  });
  it('refuses nesting deeper than 3 levels and reports it', async () => {
    const recursing: Extractor = { kind: 'png', detects: [], extract: async (b, ctx) => { await ctx.inspectNested(b, ctx); return { ghosts: [], warnings: [], unchecked: [] }; } };
    const r = await inspectWith(createRegistry({ extractors: [recursing], exorcists: [] }), png);
    expect(r.warnings.map((w) => w.code)).toContain('nested:nested:nested:nested:max-depth');
    expect(r.unchecked).toContain('embedded-media-ghost');
  });
});
