import type { Warning } from '../../types.ts';
import { ascii, readU32BE } from '../../util/bytes.ts';
import { crc32 } from '../../util/crc32.ts';

export interface PngChunk { type: string; start: number; dataStart: number; dataEnd: number; end: number; crcOk: boolean }
export interface PngWalk { chunks: PngChunk[]; iendEnd: number | undefined; warnings: Warning[] }

const isLetter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const MAX_CRC_WARNINGS = 10;

/** Walk PNG chunks from offset 8 to the first IEND (W3C PNG 3rd ed. §5). Never throws. */
export function walkPng(bytes: Uint8Array, signal?: AbortSignal): PngWalk {
  const chunks: PngChunk[] = [];
  const warnings: Warning[] = [];
  let badCrc = 0;
  let p = 8;
  while (p < bytes.length) {
    if (chunks.length % 1024 === 1023 && signal?.aborted) break;
    const len = readU32BE(bytes, p);
    if (len === undefined || len > 0x7fffffff || p + 12 + len > bytes.length) {
      warnings.push({ code: 'png-truncated', message: 'PNG ends in the middle of a chunk', offset: p });
      return { chunks, iendEnd: undefined, warnings };
    }
    for (let i = p + 4; i < p + 8; i++) {
      if (!isLetter(bytes[i]!)) {
        warnings.push({ code: 'png-bad-chunk-type', message: 'chunk type is not four ASCII letters', offset: p });
        return { chunks, iendEnd: undefined, warnings };
      }
    }
    const type = ascii(bytes, p + 4, p + 8);
    const dataStart = p + 8, dataEnd = dataStart + len, end = dataEnd + 4;
    const crcOk = crc32(bytes, p + 4, dataEnd) === readU32BE(bytes, dataEnd);
    if (!crcOk) {
      badCrc++;
      if (badCrc <= MAX_CRC_WARNINGS) warnings.push({ code: 'png-bad-crc', message: `CRC mismatch in ${type}`, offset: p });
    }
    if (chunks.length === 0 && type !== 'IHDR') warnings.push({ code: 'png-ihdr-not-first', message: 'first chunk is not IHDR', offset: p });
    chunks.push({ type, start: p, dataStart, dataEnd, end, crcOk });
    if (type === 'IEND') {
      if (badCrc > MAX_CRC_WARNINGS) warnings.push({ code: 'png-bad-crc-more', message: `${badCrc - MAX_CRC_WARNINGS} more CRC mismatches` });
      return { chunks, iendEnd: end, warnings };
    }
    p = end;
  }
  warnings.push({ code: 'png-truncated', message: 'PNG has no IEND chunk', offset: p });
  return { chunks, iendEnd: undefined, warnings };
}
