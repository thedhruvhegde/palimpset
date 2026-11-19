import type { FileKind } from '../types.ts';
import { ascii, indexOf, readU32BE, startsWith } from '../util/bytes.ts';
import { zipEntryNames } from './zip-names.ts';

export const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
export const JPEG_SOI = [0xff, 0xd8, 0xff] as const;
export const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // %PDF-
const ZIP_LFH = [0x50, 0x4b, 0x03, 0x04] as const;
const FTYP = [0x66, 0x74, 0x79, 0x70] as const;

export type SniffReason =
  | 'png-signature' | 'jpeg-soi' | `pdf-header@offset=${number}`
  | 'heic-ftyp' | 'avif-ftyp' | 'docx-central-directory' | 'docx-local-headers'
  | 'zip-without-word-document' | 'empty' | 'no-signature';

/**
 * Detect the file kind from magic bytes only. Synchronous, never throws, ignores names.
 * Rules apply in the order PNG, JPEG, PDF, HEIC, DOCX; the first match wins.
 */
export function sniff(bytes: Uint8Array): FileKind {
  return sniffDetailed(bytes).kind;
}

export function sniffDetailed(bytes: Uint8Array): { kind: FileKind; reason: SniffReason } {
  try {
    if (bytes.length === 0) return { kind: 'unknown', reason: 'empty' };
    if (startsWith(bytes, PNG_SIG)) return { kind: 'png', reason: 'png-signature' };
    if (startsWith(bytes, JPEG_SOI)) return { kind: 'jpeg', reason: 'jpeg-soi' };
    const pdfAt = indexOf(bytes, PDF_SIG, 0, 1024);
    if (pdfAt >= 0) return { kind: 'pdf', reason: `pdf-header@offset=${pdfAt}` };
    const heic = sniffHeic(bytes);
    if (heic) return heic;
    if (startsWith(bytes, ZIP_LFH)) {
      const { names, via } = zipEntryNames(bytes);
      if (names.includes('[Content_Types].xml') && names.includes('word/document.xml')) {
        return { kind: 'docx', reason: via === 'cd' ? 'docx-central-directory' : 'docx-local-headers' };
      }
      return { kind: 'unknown', reason: 'zip-without-word-document' };
    }
    return { kind: 'unknown', reason: 'no-signature' };
  } catch {
    return { kind: 'unknown', reason: 'no-signature' };
  }
}

const HEIC_MAJOR = new Set(['heic', 'heix', 'mif1']);
const HEVC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function sniffHeic(b: Uint8Array): { kind: FileKind; reason: SniffReason } | undefined {
  if (!startsWith(b, FTYP, 4)) return undefined;
  const size = readU32BE(b, 0);
  if (size === undefined || size < 16 || size > b.length) return undefined;
  const major = ascii(b, 8, 12);
  if (!HEIC_MAJOR.has(major)) return undefined;
  if (major === 'mif1') {
    const brands = new Set<string>();
    const end = Math.min(size, b.length, 64);
    for (let o = 16; o + 4 <= end; o += 4) brands.add(ascii(b, o, o + 4));
    const hasAvif = [...AVIF_BRANDS].some((x) => brands.has(x));
    const hasHevc = [...HEVC_BRANDS].some((x) => brands.has(x));
    if (hasAvif && !hasHevc) return { kind: 'unknown', reason: 'avif-ftyp' };
  }
  return { kind: 'heic', reason: 'heic-ftyp' };
}
