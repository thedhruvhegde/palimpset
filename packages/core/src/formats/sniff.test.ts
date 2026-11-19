import { describe, expect, it } from 'vitest';
import { makeJpeg, makePng, makeZip } from '../../test-support/builders.ts';
import { sniff, sniffDetailed } from './sniff.ts';

const enc = (s: string) => new TextEncoder().encode(s);
function ftyp(major: string, compat: string[]): Uint8Array {
  const size = 16 + 4 * compat.length;
  return new Uint8Array([0, 0, 0, size, ...enc('ftyp'), ...enc(major), 0, 0, 0, 0, ...compat.flatMap((c) => [...enc(c)]), ...new Array(32).fill(0)]);
}

describe('sniff', () => {
  it('detects PNG and JPEG by signature', () => {
    expect(sniff(makePng())).toBe('png');
    expect(sniff(makeJpeg())).toBe('jpeg');
  });
  it('rejects a truncated PNG signature', () => {
    expect(sniff(makePng().subarray(0, 4))).toBe('unknown');
  });
  it('finds %PDF- anywhere in the first 1024 bytes', () => {
    for (const off of [0, 37, 1019]) {
      const b = new Uint8Array(off + 20);
      b.set(enc('%PDF-1.7'), off);
      expect(sniffDetailed(b)).toEqual({ kind: 'pdf', reason: `pdf-header@offset=${off}` });
    }
    const late = new Uint8Array(1040);
    late.set(enc('%PDF-1.7'), 1020);
    expect(sniff(late)).toBe('unknown');
  });
  it('tells HEIC from AVIF', () => {
    expect(sniff(ftyp('heic', ['mif1', 'heic']))).toBe('heic');
    expect(sniff(ftyp('mif1', ['mif1', 'heic']))).toBe('heic');
    expect(sniffDetailed(ftyp('mif1', ['mif1', 'avif']))).toEqual({ kind: 'unknown', reason: 'avif-ftyp' });
  });
  it('identifies DOCX by its two required parts, not by being a ZIP', () => {
    expect(sniffDetailed(makeZip(['[Content_Types].xml', 'word/document.xml']))).toEqual({ kind: 'docx', reason: 'docx-central-directory' });
    expect(sniffDetailed(makeZip(['[Content_Types].xml', 'word/document.xml'], { centralDirectory: false }))).toEqual({ kind: 'docx', reason: 'docx-local-headers' });
    expect(sniffDetailed(makeZip(['[Content_Types].xml', 'xl/workbook.xml']))).toEqual({ kind: 'unknown', reason: 'zip-without-word-document' });
  });
  it('returns unknown for empty input', () => {
    expect(sniffDetailed(new Uint8Array())).toEqual({ kind: 'unknown', reason: 'empty' });
  });
});
