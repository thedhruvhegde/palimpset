/**
 * The ghost model: the single source of truth for every extractor, exorcist, UI view,
 * MCP tool and Crew report. Change this file first; the `types-changed` hook keeps specs in sync.
 */

/** File formats Palimpsest understands. Detected from magic bytes, never from the file name. */
export type FileKind = 'png' | 'jpeg' | 'heic' | 'pdf' | 'docx' | 'unknown';

/** How much a ghost exposes. Order matters: revenant > wraith > shade > wisp. */
export type Severity = 'revenant' | 'wraith' | 'shade' | 'wisp';
export const SEVERITY_ORDER: readonly Severity[] = ['revenant', 'wraith', 'shade', 'wisp'] as const;

/** Every kind of ghost we can find. Exorcists declare which kinds they remove. */
export type GhostKind =
  // images
  | 'trailing-data'            // bytes after PNG IEND / JPEG EOI (aCropalypse)
  | 'recovered-image'          // pixels reconstructed from trailing data
  | 'embedded-thumbnail'       // EXIF/IFD1 thumbnail that may predate a crop or edit
  | 'gps-location'
  | 'device-identity'          // make, model, serial numbers, lens serial
  | 'software-trail'           // editing software, history, XMP toolkit
  | 'capture-time'
  | 'author-identity'          // artist, copyright, XMP dc:creator, PDF/DOCX author
  | 'icc-profile-identity'     // ICC description naming a device or user
  | 'text-in-pixels'           // OCR'd text inside a recovered region (optional, best effort)
  // pdf
  | 'unredacted-text'          // live text under an opaque filled shape
  | 'prior-revision'           // earlier version kept by incremental save
  | 'pdf-metadata'             // Info dictionary and XMP packet
  | 'hidden-annotation'        // hidden/non-printing annotations, comments
  | 'embedded-file'            // attachments inside the PDF
  // docx
  | 'tracked-change'           // w:ins / w:del
  | 'comment'
  | 'revision-id'              // rsid values linking edit sessions
  | 'docx-properties'          // docProps core/app/custom
  | 'embedded-media-ghost';    // a ghost inside an image embedded in a document (nested)

/** Where in the file the ghost lives, so the UI can point at it and exorcists can remove it. */
export type GhostLocation =
  | { type: 'byte-range'; start: number; end: number }
  | { type: 'chunk'; name: string; start: number; end: number }          // PNG chunk / JPEG segment
  | { type: 'pdf-region'; page: number; rect: Rect }                      // PDF user-space rect
  | { type: 'pdf-revision'; index: number; start: number; end: number }  // byte range of revision
  | { type: 'zip-entry'; path: string; xpath?: string }                   // DOCX part
  | { type: 'nested'; container: GhostLocation; inner: GhostLocation; innerKind: FileKind };

export interface Rect { x: number; y: number; width: number; height: number }

/** Evidence shown to the user. Values are display strings; `raw` holds structured data. */
export interface GhostEvidence {
  summary: string;                         // "GPS 51.5033, -0.1196"
  fields?: Record<string, string>;         // label -> value, rendered in mono
  /** Pixels to render in the reveal layer (recovered region, thumbnail, revision page). */
  preview?: { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array; width: number; height: number };
  raw?: unknown;
}

export interface Ghost {
  id: string;                              // stable within one inspection: `${kind}:${n}`
  kind: GhostKind;
  severity: Severity;
  title: string;                           // human title for the Séance Ledger
  explanation: string;                     // one or two sentences: why this matters
  location: GhostLocation;
  evidence: GhostEvidence;
  /** Confidence 0..1. Below 0.6 the UI says "possible ghost". */
  confidence: number;
}

export interface Warning { code: string; message: string; offset?: number }

export interface Inspection {
  kind: FileKind;
  size: number;
  ghosts: Ghost[];
  warnings: Warning[];
  /** Ghost kinds this format can carry but we could not check, shown under "What we can't see". */
  unchecked: GhostKind[];
  durationMs: number;
}

export interface ExtractContext {
  /** Abort long work (time budget, user cancel). Extractors must check it in loops. */
  signal?: AbortSignal;
  /** Recursion depth for nested files (DOCX → JPEG). Max 3. */
  depth: number;
  /** Re-enter the registry for nested files. */
  inspectNested(bytes: Uint8Array, ctx: ExtractContext): Promise<Inspection>;
  /** Optional platform adapters injected by the host (browser/Node). */
  adapters: PlatformAdapters;
}

export interface PlatformAdapters {
  /** Decode PNG/JPEG pixels (browser: createImageBitmap/OffscreenCanvas; Node: injected decoder). */
  decodeImage?(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>;
  /** Encode RGBA to PNG/JPEG (used by exorcists that re-encode pixels). */
  encodeImage?(img: { width: number; height: number; rgba: Uint8ClampedArray }, mime: 'image/png' | 'image/jpeg'): Promise<Uint8Array>;
}

/** One per format. Must never throw: return partial results plus warnings. */
export interface Extractor {
  kind: FileKind;
  /** Every ghost kind this extractor can report (drives `unchecked` and the Paw's generators). */
  detects: readonly GhostKind[];
  extract(bytes: Uint8Array, ctx: ExtractContext): Promise<Omit<Inspection, 'durationMs' | 'kind' | 'size'>>;
}

export interface ExorciseOptions {
  /** Ghost kinds to remove; default = all kinds in `Exorcist.removes`. */
  kinds?: readonly GhostKind[];
  /** Re-encode images from visible pixels (strongest; default true). */
  reencode?: boolean;
  /** PDF: flatten pages that contain bad redactions to images (default true). */
  rasterizeRedactions?: boolean;
}

export interface Exorcism {
  output: Uint8Array;
  banished: { kind: GhostKind; count: number }[];
  /** Post-exorcism inspection of `output` (G3). The UI shows "0 ghosts found in output". */
  verification: Inspection;
  warnings: Warning[];
}

/** One per format. Must not mutate `bytes` (G2). */
export interface Exorcist {
  kind: FileKind;
  removes: readonly GhostKind[];
  exorcise(bytes: Uint8Array, ctx: ExtractContext, opts: ExorciseOptions): Promise<Omit<Exorcism, 'verification'>>;
}

/** Canonical order of ghost kinds (drives `unchecked` ordering, schemas and the Paw). */
export const GHOST_KINDS = [
  'trailing-data', 'recovered-image', 'embedded-thumbnail', 'gps-location', 'device-identity',
  'software-trail', 'capture-time', 'author-identity', 'icc-profile-identity', 'text-in-pixels',
  'unredacted-text', 'prior-revision', 'pdf-metadata', 'hidden-annotation', 'embedded-file',
  'tracked-change', 'comment', 'revision-id', 'docx-properties', 'embedded-media-ghost',
] as const satisfies readonly GhostKind[];

/** Options for a top-level inspect/exorcise call. */
export interface InspectOptions {
  signal?: AbortSignal;
  /** Override the default budget (2 s per MiB, min 1 s, max 120 s). Integer 1..600000. */
  budgetMs?: number;
  adapters?: PlatformAdapters;
}
