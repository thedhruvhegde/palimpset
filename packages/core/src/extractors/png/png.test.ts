import { describe, expect, it } from 'vitest';
import { concat, makeJpeg, makePng, pngChunk } from '../../../test-support/builders.ts';
import { inspect } from '../../index.ts';
import { walkPng } from './walk.ts';

describe('PNG walker', () => {
  it('walks to IEND with exact offsets and valid CRCs', () => {
    const p = makePng();
    const w = walkPng(p);
    expect(w.chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(w.chunks.every((c) => c.crcOk)).toBe(true);
    expect(w.iendEnd).toBe(p.length);
    expect(w.chunks[0]).toMatchObject({ start: 8, dataStart: 16, dataEnd: 29, end: 33 });
  });
  it('flags a bad CRC and keeps going', () => {
    const p = makePng(); p[29] = p[29]! ^ 0xff;
    const w = walkPng(p);
    expect(w.warnings.map((x) => x.code)).toContain('png-bad-crc');
    expect(w.iendEnd).toBe(p.length);
  });
  it('reports truncation without an IEND', () => {
    const p = makePng();
    const w = walkPng(p.subarray(0, p.length - 6));
    expect(w.iendEnd).toBeUndefined();
    expect(w.warnings.map((x) => x.code)).toContain('png-truncated');
  });
});

describe('PNG trailing data', () => {
  it('reports nothing for a clean PNG, but stays honest about what it did not check', async () => {
    const r = await inspect(makePng());
    expect(r.ghosts).toEqual([]);
    expect(r.unchecked).toContain('gps-location');
  });
  it('flags an aCropalypse-style tail (an IDAT chunk after IEND) as a wraith', async () => {
    const original = makePng(16, 16);
    const cropped = makePng(4, 4);
    const tail = original.subarray(33); // IDAT + IEND of the larger original
    const r = await inspect(concat(cropped, tail));
    const g = r.ghosts.find((x) => x.kind === 'trailing-data')!;
    expect(g.severity).toBe('wraith');
    expect(g.location).toEqual({ type: 'byte-range', start: cropped.length, end: cropped.length + tail.length });
    expect(g.evidence.fields?.['Looks like']).toMatch(/aCropalypse/);
  });
  it('treats a JPEG appended after IEND as an embedded file and inspects inside it', async () => {
    const hidden = concat(makeJpeg(), [0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const r = await inspect(concat(makePng(), hidden));
    const trailing = r.ghosts.find((x) => x.kind === 'trailing-data')!;
    expect(trailing.evidence.raw).toMatchObject({ class: 'embedded-file' });
    const nested = r.ghosts.find((x) => x.kind === 'embedded-media-ghost');
    expect(nested?.location.type).toBe('nested');
  });
  it('classifies zero padding as a low-risk wisp', async () => {
    const r = await inspect(concat(makePng(), new Uint8Array(8)));
    expect(r.ghosts[0]).toMatchObject({ kind: 'trailing-data', severity: 'wisp' });
  });
  it('does not confuse a text chunk with trailing data', async () => {
    const r = await inspect(makePng(4, 4, [0, 0, 0, 255], [pngChunk('tEXt', [...new TextEncoder().encode('Author\0Ada Quill')])]));
    expect(r.ghosts.filter((g) => g.kind === 'trailing-data')).toEqual([]);
  });
});
