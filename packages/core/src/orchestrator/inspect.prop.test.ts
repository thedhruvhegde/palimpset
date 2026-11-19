import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { inspect } from '../index.ts';
import { InspectionSchema } from '../schema.ts';
import { makeJpeg, makePng } from '../../test-support/builders.ts';

import { RUNS as runs } from '../../test-support/runs.ts';
const seeds = [makePng(), makeJpeg()];

describe('inspect properties', () => {
  it('Property 7: never rejects on arbitrary or mutated bytes, and returns a valid Inspection', async () => {
    const arbMutated = fc.tuple(fc.constantFrom(...seeds), fc.nat(), fc.uint8Array({ maxLength: 64 })).map(([b, at, junk]) => {
      const c = b.slice(); const o = at % c.length;
      c.set(junk.subarray(0, c.length - o), o);
      return c;
    });
    await fc.assert(fc.asyncProperty(fc.oneof(fc.uint8Array({ maxLength: 2048 }), arbMutated), async (b) => {
      const r = await inspect(b);
      expect(InspectionSchema.safeParse(r).success).toBe(true);
      expect(r.size).toBe(b.byteLength);
    }), { numRuns: runs });
  });
});
