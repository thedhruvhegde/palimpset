/** Tiny synthetic file builders for tests. Never real personal data. */
import { crc32 } from '../src/util/crc32.ts';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
export const concat = (...parts: (Uint8Array | number[])[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function adler32(d: Uint8Array): number {
  let a = 1, b = 0;
  for (const x of d) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
/** zlib stream made of stored (uncompressed) deflate blocks. */
export function zlibStored(data: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01];
  for (let o = 0; o < data.length || o === 0; o += 65535) {
    const chunk = data.subarray(o, o + 65535);
    const final = o + 65535 >= data.length ? 1 : 0;
    blocks.push(final, ...le16(chunk.length), ...le16(~chunk.length & 0xffff), ...chunk);
    if (data.length === 0) break;
  }
  blocks.push(...be32(adler32(data)));
  return new Uint8Array(blocks);
}

export function pngChunk(type: string, data: Uint8Array | number[] = []): Uint8Array {
  const body = concat(ascii(type), data);
  return concat(be32(data.length), body, be32(crc32(body)));
}

export const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A valid RGBA PNG of the given size with a solid color. */
export function makePng(width = 4, height = 4, rgba: [number, number, number, number] = [200, 120, 60, 255], extraChunks: Uint8Array[] = []): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(rgba, y * (1 + width * 4) + 1 + x * 4);
  const ihdr = [...be32(width), ...be32(height), 8, 6, 0, 0, 0];
  return concat(PNG_SIG, pngChunk('IHDR', ihdr), ...extraChunks, pngChunk('IDAT', zlibStored(raw)), pngChunk('IEND'));
}

/** Minimal structurally valid JPEG: SOI, APP0, DQT-like segment, SOS + entropy bytes, EOI. */
export function makeJpeg(entropy: number[] = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]): Uint8Array {
  const app0 = [0xff, 0xe0, ...[0, 16], ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sos, ...entropy, 0xff, 0xd9]);
}

/** Minimal ZIP with stored entries and a central directory. */
export function makeZip(names: string[], opts: { centralDirectory?: boolean } = {}): Uint8Array {
  const locals: number[] = [];
  const central: number[] = [];
  for (const name of names) {
    const n = ascii(name);
    const offset = locals.length;
    locals.push(0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(0), ...le32(0), ...le32(0), ...le16(n.length), ...le16(0), ...n);
    central.push(0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(0), ...le32(0), ...le32(0), ...le16(n.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(offset), ...n);
  }
  if (opts.centralDirectory === false) return new Uint8Array(locals);
  const eocd = [0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, ...le16(names.length), ...le16(names.length), ...le32(central.length), ...le32(locals.length), 0, 0];
  return new Uint8Array([...locals, ...central, ...eocd]);
}
