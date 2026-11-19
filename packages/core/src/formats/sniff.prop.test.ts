import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sniff } from './sniff.ts';

import { RUNS as runs } from '../../test-support/runs.ts';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const KINDS = new Set(['png', 'jpeg', 'heic', 'pdf', 'docx', 'unknown']);

describe('sniff properties', () => {
  it('Property 1: any bytes after the PNG signature sniff as png', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 512 }), (s) => sniff(new Uint8Array([...PNG, ...s])) === 'png'), { numRuns: runs });
  });
  it('Property 2: any bytes after FF D8 FF sniff as jpeg', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 512 }), (s) => sniff(new Uint8Array([0xff, 0xd8, 0xff, ...s])) === 'jpeg'), { numRuns: runs });
  });
  it('Property 6: sniff is total, never throws, and ignores the view offset', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 4096 }), fc.nat(16), (b, cut) => {
      const k = sniff(b);
      expect(KINDS.has(k)).toBe(true);
      expect(sniff(b.slice())).toBe(k);
      const padded = new Uint8Array(cut + b.length);
      padded.set(b, cut);
      expect(sniff(padded.subarray(cut))).toBe(k);
    }), { numRuns: runs });
  });
});
