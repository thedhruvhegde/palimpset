import { ascii, readU16LE, readU32LE, startsWith } from '../util/bytes.ts';

const EOCD = [0x50, 0x4b, 0x05, 0x06];
const CDH = [0x50, 0x4b, 0x01, 0x02];
const LFH = [0x50, 0x4b, 0x03, 0x04];
const LOCAL_SCAN_LIMIT = 16 * 1024 * 1024;

/**
 * Lists ZIP entry names without inflating anything (PKWARE APPNOTE 6.3.x).
 * Central directory first; falls back to local file headers. Never throws.
 */
export function zipEntryNames(bytes: Uint8Array, maxEntries = 10_000): { names: string[]; via: 'cd' | 'local' | 'none' } {
  try {
    const cd = fromCentralDirectory(bytes, maxEntries);
    if (cd) return { names: cd, via: 'cd' };
    const local = fromLocalHeaders(bytes, maxEntries);
    return local.length ? { names: local, via: 'local' } : { names: [], via: 'none' };
  } catch {
    return { names: [], via: 'none' };
  }
}

function fromCentralDirectory(b: Uint8Array, max: number): string[] | undefined {
  const lowest = Math.max(0, b.length - 65_557);
  let eocd = -1;
  for (let i = b.length - 22; i >= lowest; i--) {
    if (startsWith(b, EOCD, i)) { eocd = i; break; }
  }
  if (eocd < 0) return undefined;
  const count = readU16LE(b, eocd + 10);
  const offset = readU32LE(b, eocd + 16);
  if (count === undefined || offset === undefined) return undefined;
  if (count === 0xffff || offset === 0xffffffff) return undefined; // ZIP64: use local headers
  const names: string[] = [];
  let p = offset;
  for (let n = 0; n < Math.min(count, max); n++) {
    if (!startsWith(b, CDH, p)) return undefined;
    const nameLen = readU16LE(b, p + 28);
    const extraLen = readU16LE(b, p + 30);
    const commentLen = readU16LE(b, p + 32);
    if (nameLen === undefined || extraLen === undefined || commentLen === undefined) return undefined;
    if (p + 46 + nameLen > b.length) return undefined;
    names.push(ascii(b, p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function fromLocalHeaders(b: Uint8Array, max: number): string[] {
  const names: string[] = [];
  const limit = Math.min(b.length, LOCAL_SCAN_LIMIT);
  let p = 0;
  while (names.length < max && p + 30 <= limit && startsWith(b, LFH, p)) {
    const flags = readU16LE(b, p + 6) ?? 0;
    const compSize = readU32LE(b, p + 18) ?? 0;
    const nameLen = readU16LE(b, p + 26) ?? 0;
    const extraLen = readU16LE(b, p + 28) ?? 0;
    if (p + 30 + nameLen > b.length) break;
    names.push(ascii(b, p + 30, p + 30 + nameLen));
    const dataStart = p + 30 + nameLen + extraLen;
    if ((flags & 0x08) !== 0 && compSize === 0) {
      // Data descriptor with unknown size: search forward for the next local header.
      let q = dataStart;
      while (q + 4 <= limit && !startsWith(b, LFH, q)) q++;
      p = q;
    } else {
      p = dataStart + compSize;
    }
  }
  return names;
}
