/** Bounds-checked big/little-endian readers. Out of range returns undefined, never throws. */
export function readU16BE(b: Uint8Array, o: number): number | undefined {
  if (o < 0 || o + 2 > b.length) return undefined;
  return (b[o]! << 8) | b[o + 1]!;
}
export function readU16LE(b: Uint8Array, o: number): number | undefined {
  if (o < 0 || o + 2 > b.length) return undefined;
  return b[o]! | (b[o + 1]! << 8);
}
export function readU32BE(b: Uint8Array, o: number): number | undefined {
  if (o < 0 || o + 4 > b.length) return undefined;
  return ((b[o]! << 24) >>> 0) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!);
}
export function readU32LE(b: Uint8Array, o: number): number | undefined {
  if (o < 0 || o + 4 > b.length) return undefined;
  return ((b[o + 3]! << 24) >>> 0) + ((b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!);
}

/** First index of `needle` in `bytes[from, to)`, or -1. */
export function indexOf(bytes: Uint8Array, needle: ArrayLike<number>, from = 0, to = bytes.length): number {
  const n = needle.length;
  const end = Math.min(to, bytes.length) - n;
  if (n === 0) return from <= bytes.length ? Math.max(0, from) : -1;
  const first = needle[0]!;
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < n; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function startsWith(bytes: Uint8Array, prefix: ArrayLike<number>, at = 0): boolean {
  if (at < 0 || at + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[at + i] !== prefix[i]) return false;
  return true;
}

export function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = Math.max(0, start); i < Math.min(end, bytes.length); i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

export const hex32 = (n: number): string => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
