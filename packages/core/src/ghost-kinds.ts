import { GHOST_KINDS, type FileKind, type GhostKind } from './types.ts';

export { GHOST_KINDS };

// Compile-time exhaustiveness: every GhostKind must appear in GHOST_KINDS.
type _Missing = Exclude<GhostKind, (typeof GHOST_KINDS)[number]>;
const _check: [_Missing] extends [never] ? true : never = true;
void _check;

const IMAGE: readonly GhostKind[] = [
  'trailing-data', 'recovered-image', 'embedded-thumbnail', 'gps-location', 'device-identity',
  'software-trail', 'capture-time', 'author-identity', 'icc-profile-identity', 'text-in-pixels',
];

/** Ghost kinds each format can hold according to its spec (not what we detect). */
export const CARRIES: Readonly<Record<FileKind, readonly GhostKind[]>> = {
  png: IMAGE,
  jpeg: IMAGE,
  heic: IMAGE.filter((k) => k !== 'recovered-image'),
  pdf: ['author-identity', 'software-trail', 'capture-time', 'text-in-pixels', 'unredacted-text', 'prior-revision', 'pdf-metadata', 'hidden-annotation', 'embedded-file', 'embedded-media-ghost'],
  docx: ['software-trail', 'capture-time', 'author-identity', 'tracked-change', 'comment', 'revision-id', 'docx-properties', 'embedded-media-ghost'],
  unknown: GHOST_KINDS,
};

export function carries(kind: FileKind): readonly GhostKind[] {
  return CARRIES[kind];
}

const RANK = new Map<GhostKind, number>(GHOST_KINDS.map((k, i) => [k, i]));

/** Dedupe and sort kinds into canonical GHOST_KINDS order. */
export function sortCanonical(kinds: Iterable<GhostKind>): GhostKind[] {
  return [...new Set(kinds)].sort((a, b) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0));
}
