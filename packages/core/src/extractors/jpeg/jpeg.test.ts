import { describe, expect, it } from 'vitest';
import { concat, makeJpeg } from '../../../test-support/builders.ts';
import { inspect } from '../../index.ts';
import { walkJpeg } from './walk.ts';

describe('JPEG walker', () => {
  it('skips stuffed bytes and restart markers inside entropy data to find EOI', () => {
    const j = makeJpeg();
    const w = walkJpeg(j);
    expect(w.eoiEnd).toBe(j.length);
    expect(w.segments.map((s) => s.marker)).toEqual([0xe0, 0xda, 0xd9]);
  });
  it('reports truncation when there is no EOI', () => {
    const j = makeJpeg();
    expect(walkJpeg(j.subarray(0, j.length - 2)).eoiEnd).toBeUndefined();
  });
  it('flags a cropped JPEG that still carries the old image tail', async () => {
    const tail = [0x11, 0x22, 0x33, 0x44, 0xff, 0x00, 0x55, 0xff, 0xd9];
    const r = await inspect(concat(makeJpeg(), tail));
    expect(r.ghosts[0]).toMatchObject({ kind: 'trailing-data', severity: 'wraith' });
    expect(r.ghosts[0]!.evidence.raw).toEqual({ class: 'jpeg-entropy-tail', length: tail.length });
  });
});
