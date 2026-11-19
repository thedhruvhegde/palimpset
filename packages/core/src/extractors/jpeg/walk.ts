import type { Warning } from '../../types.ts';
import { readU16BE } from '../../util/bytes.ts';

export interface JpegSegment { marker: number; start: number; dataStart: number; end: number }
export interface JpegWalk { segments: JpegSegment[]; eoiEnd: number | undefined; warnings: Warning[] }

/**
 * Walk the primary image of a JPEG (ITU-T T.81 Annex B) to its EOI.
 * Marker segments carry a 2-byte length; after SOS, entropy-coded data runs until a marker
 * that is not a stuffed byte (FF 00) or a restart marker (FF D0-D7). Fill bytes (FF FF) are skipped.
 */
export function walkJpeg(bytes: Uint8Array, signal?: AbortSignal): JpegWalk {
  const segments: JpegSegment[] = [];
  const warnings: Warning[] = [];
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { segments, eoiEnd: undefined, warnings: [{ code: 'jpeg-no-soi', message: 'missing SOI', offset: 0 }] };
  let p = 2;
  let steps = 0;
  while (p < bytes.length) {
    if (++steps % 1024 === 0 && signal?.aborted) break;
    if (bytes[p] !== 0xff) {
      warnings.push({ code: 'jpeg-bad-marker', message: 'expected a marker', offset: p });
      return { segments, eoiEnd: undefined, warnings };
    }
    while (bytes[p + 1] === 0xff) p++; // fill bytes
    const marker = bytes[p + 1];
    if (marker === undefined) break;
    const start = p;
    if (marker === 0xd9) { // EOI
      segments.push({ marker, start, dataStart: p + 2, end: p + 2 });
      return { segments, eoiEnd: p + 2, warnings };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; } // standalone
    const len = readU16BE(bytes, p + 2);
    if (len === undefined || len < 2 || p + 2 + len > bytes.length) {
      warnings.push({ code: 'jpeg-truncated', message: 'segment runs past the end of the file', offset: p });
      return { segments, eoiEnd: undefined, warnings };
    }
    const end = p + 2 + len;
    segments.push({ marker, start, dataStart: p + 4, end });
    p = end;
    if (marker === 0xda) { // SOS: skip entropy-coded data
      let q = p;
      while (q + 1 < bytes.length) {
        if (bytes[q] === 0xff) {
          const n = bytes[q + 1]!;
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) { q += n === 0xff ? 1 : 2; continue; }
          break;
        }
        q++;
      }
      p = q;
    }
  }
  warnings.push({ code: 'jpeg-truncated', message: 'no EOI marker found', offset: p });
  return { segments, eoiEnd: undefined, warnings };
}
