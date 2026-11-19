import { sniff } from '../formats/sniff.ts';
import type { ExtractContext, FileKind, Ghost, Severity } from '../types.ts';
import { hex32, indexOf, readU32BE } from '../util/bytes.ts';
import { crc32 } from '../util/crc32.ts';
import { nestGhosts } from '../nested.ts';
import { SEVERITY_ORDER } from '../types.ts';

export type TrailingClass = 'png-idat-tail' | 'embedded-file' | 'mpf' | 'jpeg-entropy-tail' | 'samsung-sef' | 'zeros' | 'unknown';

const IEND_TAIL = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const IDAT = [0x49, 0x44, 0x41, 0x54];
const SIGS = [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0xff, 0xd8, 0xff], [0x25, 0x50, 0x44, 0x46, 0x2d], [0x50, 0x4b, 0x03, 0x04]];

const LABEL: Record<TrailingClass, string> = {
  'png-idat-tail': 'the end of a larger PNG (aCropalypse pattern)',
  'embedded-file': 'a whole second file hidden after the image',
  'mpf': 'extra images from a multi-picture JPEG',
  'jpeg-entropy-tail': 'the end of a larger JPEG (aCropalypse pattern)',
  'samsung-sef': 'Samsung editing data',
  'zeros': 'padding (all zero bytes)',
  'unknown': 'unrecognized data',
};

function hasValidIdatHeader(t: Uint8Array): boolean {
  for (let i = indexOf(t, IDAT, 4); i >= 4; i = indexOf(t, IDAT, i + 1)) {
    const len = readU32BE(t, i - 4);
    if (len === undefined || i + 4 + len + 4 > t.length) continue;
    if (crc32(t, i, i + 4 + len) === readU32BE(t, i + 4 + len)) return true;
  }
  return false;
}

/** Find an embedded file at offset ≤ 64 inside the trailing bytes. */
export function embeddedStart(t: Uint8Array): number | undefined {
  if (sniff(t) !== 'unknown') return 0;
  for (const sig of SIGS) {
    const at = indexOf(t, sig, 0, 64 + sig.length);
    if (at >= 0 && sniff(t.subarray(at)) !== 'unknown') return at;
  }
  return undefined;
}

export function classifyTrailing(t: Uint8Array, container: FileKind): TrailingClass {
  if (container === 'png' && (hasValidIdatHeader(t) || endsWith(t, IEND_TAIL))) return 'png-idat-tail';
  if (embeddedStart(t) !== undefined) return 'embedded-file';
  if (container === 'jpeg' && endsWith(t, [0xff, 0xd9]) && indexOf(t, [0xff, 0xd8, 0xff]) < 0) return 'jpeg-entropy-tail';
  if (endsWith(t, [0x53, 0x45, 0x46, 0x54])) return 'samsung-sef';
  if (t.every((b) => b === 0)) return 'zeros';
  return 'unknown';
}

function endsWith(t: Uint8Array, s: number[]): boolean {
  if (t.length < s.length) return false;
  for (let i = 0; i < s.length; i++) if (t[t.length - s.length + i] !== s[i]) return false;
  return true;
}

function baseSeverity(c: TrailingClass, len: number): Severity {
  if (c === 'png-idat-tail' || c === 'jpeg-entropy-tail' || c === 'embedded-file') return 'wraith';
  if (c === 'samsung-sef' || (c === 'unknown' && len >= 16)) return 'shade';
  return 'wisp';
}

/** Build the trailing-data ghost (plus nested ghosts for embedded files). */
export async function trailingGhosts(bytes: Uint8Array, endMarker: number, container: FileKind, ctx: ExtractContext): Promise<Ghost[]> {
  const t = bytes.subarray(endMarker);
  const cls = classifyTrailing(t, container);
  let severity = baseSeverity(cls, t.length);
  const out: Ghost[] = [];
  if (cls === 'embedded-file') {
    const at = embeddedStart(t) ?? 0;
    const inner = await ctx.inspectNested(t.subarray(at), ctx);
    const nested = nestGhosts(inner, { type: 'byte-range', start: endMarker + at, end: bytes.length });
    for (const g of nested) if (SEVERITY_ORDER.indexOf(g.severity) < SEVERITY_ORDER.indexOf(severity)) severity = g.severity;
    out.push(...nested);
  }
  out.unshift({
    id: 'trailing-data:0',
    kind: 'trailing-data',
    severity,
    title: cls === 'png-idat-tail' || cls === 'jpeg-entropy-tail' ? 'Cropped-away image data' : 'Hidden bytes after the image ends',
    explanation: cls === 'png-idat-tail' || cls === 'jpeg-entropy-tail'
      ? 'The file was cropped or edited in place, but the bytes of the original, larger image were left behind after the end marker. Parts of what you cut out may be recoverable.'
      : 'Data sits after the point where image viewers stop reading. You cannot see it, but anyone who opens the raw file can.',
    location: { type: 'byte-range', start: endMarker, end: bytes.length },
    evidence: {
      summary: `${t.length.toLocaleString('en-US')} bytes after the end marker`,
      fields: { Bytes: String(t.length), 'Starts at': hex32(endMarker), 'Looks like': LABEL[cls] },
      raw: { class: cls, length: t.length },
    },
    confidence: 1,
  });
  return out;
}
