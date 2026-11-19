import { describe, expect, it } from 'vitest';
import { indexOf, readU16BE, readU16LE, readU32BE, readU32LE } from './bytes.ts';
import { crc32 } from './crc32.ts';

describe('byte readers', () => {
  const b = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01]);
  it('read in both byte orders', () => {
    expect(readU16BE(b, 0)).toBe(0xdead);
    expect(readU16LE(b, 0)).toBe(0xadde);
    expect(readU32BE(b, 0)).toBe(0xdeadbeef);
    expect(readU32LE(b, 0)).toBe(0xefbeadde);
  });
  it('return undefined out of range instead of throwing', () => {
    expect(readU32BE(b, 2)).toBeUndefined();
    expect(readU16LE(b, -1)).toBeUndefined();
  });
  it('work on subarray views with a non-zero byteOffset', () => {
    const view = new Uint8Array([9, 9, 0xbe, 0xef]).subarray(2);
    expect(readU16BE(view, 0)).toBe(0xbeef);
    expect(indexOf(view, [0xef])).toBe(1);
  });
  it('indexOf respects the [from, to) window', () => {
    const h = new Uint8Array([1, 2, 3, 1, 2, 3]);
    expect(indexOf(h, [1, 2], 1)).toBe(3);
    expect(indexOf(h, [1, 2], 1, 4)).toBe(-1);
  });
});

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
