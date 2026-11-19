# Design Document

## Overview

Exorcism has two layers:

1. **The pipeline** (`orchestrator/exorcise.ts`). It is format-agnostic and wraps every exorcist. It resolves the effective kinds `E`, gives the exorcist a private copy (G2), checks that the output is still the same format, re-inspects the output with the full registry (G3), runs one corrective second pass if needed, and computes `banished` and the honesty warnings (G6). The pipeline never relies on an exorcist's claims: `banished` comes only from comparing `prior` with `verification`.
2. **Exorcists**, one per format, each exporting `export const exorcist: Exorcist`.
   - **PNG/JPEG**: the strongest mode re-encodes from visible pixels. A byte-exact chunk or segment strip is used when re-encoding is off or impossible. In both modes an allowlist is applied last.
   - **PDF**: a full rewrite with pdf-lib, plus garbage collection. This removes prior revisions by construction. Metadata, hidden annotations and embedded files are removed, and pages with fake redactions are rasterized.
   - **DOCX**: XML-level acceptance of tracked changes and removal of comments, rsids and docProps. Images in `word/media/` are cleaned by recursing through the image exorcists. The ZIP is rewritten with neutral timestamps.

Order of operations inside each exorcist: destructive structural steps first (rasterize, accept revisions), then metadata removal, then garbage collection or allowlisting, then serialization. Whatever earlier steps leave behind, the allowlist step removes it.

## Architecture

### File layout

```
packages/core/src/
  orchestrator/exorcise.ts        pipeline (replaces the dispatch-only version from ghost-model-and-ingest task 11)
  naming.ts                       cleanFileName
  exorcists/
    png/index.ts                  exorcist (kind 'png'); strip.ts (allowlist + subset), reencode.ts
    jpeg/index.ts                 exorcist (kind 'jpeg'); strip.ts, orientation-app1.ts, jfif.ts, reencode.ts
    pdf/index.ts                  exorcist (kind 'pdf', lazy: pdf-lib)
      metadata.ts                 Info/ID/Metadata/PieceInfo/LastModified/M
      annotations.ts              hidden/non-link annotations, widgets, AcroForm pruning
      attachments.ts              EmbeddedFiles, AF, Collection
      rasterize.ts                page replacement from adapters.rasterizePdfPage
      gc.ts                       reachability + deletion on PDFContext
      signatures.ts               signature detection → warning
    docx/index.ts                 exorcist (kind 'docx', lazy: jszip, @xmldom/xmldom)
      opc.ts                      parts, rels, content types (read/modify/validate)
      revisions.ts                accept tracked changes (incl. paragraph-mark merge, tables)
      anonymize.ts                author-only mode
      comments.ts                 comment parts, ranges, references
      rsid.ts                     rsid attrs, w:rsids, w14:paraId/textId
      props.ts                    docProps/*, attachedTemplate
      media.ts                    nested image exorcism
      zip-write.ts                neutral timestamps, order, compression, extra-field scrub
  adapters/
    node.ts                       reference Node adapters (pngjs, jpeg-js, pdfjs-dist + @napi-rs/canvas); separate entry "@palimpsest/core/node-adapters"
apps/web/src/adapters.ts          browser adapters (createImageBitmap, OffscreenCanvas, pdfjs render in worker)
```

### Pipeline

```mermaid
sequenceDiagram
  participant C as caller (worker / MCP)
  participant P as pipeline
  participant R as registry
  participant X as exorcist
  participant I as inspect
  C->>P: exorcise(bytes, opts, run)
  P->>P: validate opts (zod), sniff, size check
  P->>I: prior = run.prior ✓ size/kind ? run.prior : inspect(bytes)
  P->>R: exorcist(kind)
  P->>P: E = (opts.kinds ?? removes) ∩ removes  (− unredacted-text if !rasterize)
  alt E empty
    P-->>C: output = bytes.slice(), nothing-to-remove
  end
  P->>X: exorcise(bytes.slice(), ctx{depth 0, signal(budget×3), exorciseNested}, {kinds:E,...})
  X-->>P: {output, banished(ignored), warnings}
  P->>P: sniff(output) == kind ? else fail(output-kind-mismatch)
  P->>I: verification = inspect(output)
  opt survivors in E
    P->>X: second pass on output
    P->>I: re-verify
  end
  P->>P: banished = E ∩ (prior − verification); collateral; ghost-survived; verification-incomplete
  P-->>C: Exorcism
```

The `banished` value an exorcist returns is ignored. The pipeline recomputes it.

## Components and Interfaces

```ts
// orchestrator/exorcise.ts
export function exorciseWith(
  registry: Registry, bytes: Uint8Array, opts?: ExorciseOptions, run?: InspectOptions & { prior?: Inspection },
): Promise<Exorcism>;
export function effectiveKinds(removes: readonly GhostKind[], opts: ExorciseOptions):
  { E: GhostKind[]; warnings: Warning[] };
export function computeBanished(prior: Inspection, verification: Inspection, E: readonly GhostKind[]):
  { banished: Exorcism['banished']; survived: { kind: GhostKind; count: number }[]; collateral: GhostKind[] };
export function summarizeExorcism(x: Exorcism): 'clean' | 'residual' | 'failed';

// naming.ts
export function cleanFileName(original: string, kind: FileKind): string;

// exorcists/png
export const exorcist: Exorcist;                 // kind 'png', removes per Req 5.1
export const PNG_KEEP: ReadonlySet<string>;      // allowlist Req 5.3
export function stripPng(bytes: Uint8Array, plan: { mode: 'allowlist' } | { mode: 'subset'; dropRanges: Extent[] }):
  { ok: true; out: Uint8Array; dropped: string[] } | { ok: false; code: 'png-unrepairable' };
export function reencodePng(bytes: Uint8Array, a: Required<Pick<PlatformAdapters, 'decodeImage' | 'encodeImage'>>):
  Promise<{ out: Uint8Array; warnings: Warning[] }>;

// exorcists/jpeg
export const exorcist: Exorcist;                 // kind 'jpeg'
export function stripJpeg(bytes: Uint8Array, plan: StripPlan): { ok: true; out: Uint8Array } | { ok: false; code: 'jpeg-unrepairable' };
export function orientationApp1(orientation: 2 | 3 | 4 | 5 | 6 | 7 | 8): Uint8Array;   // the 36-byte segment
export function neutralJfif(src: JpegSegment, bytes: Uint8Array): Uint8Array;          // 18-byte segment

// exorcists/pdf
export const exorcist: Exorcist;                 // kind 'pdf'
export function collectGarbage(doc: PDFDocument): { deleted: number };
export function removeMetadata(doc: PDFDocument): void;
export function removeAnnotations(doc: PDFDocument): { removed: number };
export function removeAttachments(doc: PDFDocument): { removed: number };
/** pages are 1-based, taken from the PDF extractor's unredacted-text ghosts (pdf-region.page). */
export function rasterizePages(doc: PDFDocument, src: Uint8Array, pages: number[], a: PlatformAdapters, signal?: AbortSignal):
  Promise<{ rasterized: number[]; failed: number[] }>;
export function pagesWithBadRedactions(bytes: Uint8Array, ctx: ExtractContext): Promise<number[]>;  // calls pdf extractor.extract directly

// exorcists/docx
export const exorcist: Exorcist;                 // kind 'docx'
export interface Package { zip: JSZip; order: string[]; stored: Set<string>; contentTypes: Document; rels: Map<string, Document> }
export function acceptRevisions(doc: Document): { accepted: number; warnings: Warning[] };
export function anonymizeRevisions(doc: Document): void;
export function stripComments(pkg: Package): Promise<void>;
export function stripRsids(doc: Document, keepParaIds: boolean): void;
export function stripProperties(pkg: Package): Promise<void>;
export function cleanMedia(pkg: Package, ctx: ExtractContext, opts: ExorciseOptions): Promise<Warning[]>;
export function writePackage(pkg: Package): Promise<Uint8Array>;
export function validateOpc(pkg: Package): Warning[];   // used by tests and as a final self-check
```

### Key algorithms

**PNG/JPEG subset mode.** The image exorcist imports the matching `image-ghosts` extractor and calls its `extract(bytes, ctx)` directly. This is a plain call, not through the registry, so depth does not increase. It drops every chunk or segment that contains the start offset of a ghost whose kind is in `E`, and the trailing range when `trailing-data` or `recovered-image` is in `E`. Kinds in `E` that live in a container shared with other kinds (one Exif segment) take the whole container with them. The pipeline reports this as `collateral-removal`.

**Display orientation.** The decode adapter returns pixels already rotated by EXIF Orientation. The re-encoded JPEG therefore needs no orientation tag, and its stored dimensions are the display dimensions (width and height swapped for orientations 5–8).

**PDF garbage collection.** Start a work list at `trailer.Root`. Pop a ref, look up the object, and push every `PDFRef` found by walking `PDFDict` values, `PDFArray` items and `PDFStream.dict`. Then, for every ref in `context.enumerateIndirectObjects()` that was not visited, call `context.delete(ref)`. pdf-lib's parser processes sections from the start of the file, and later definitions of the same object number replace earlier ones. GC then removes earlier-revision objects that are no longer referenced, including content streams replaced by rasterization.

**DOCX revision acceptance.** This is one post-order traversal per part, so that nested revisions inside a deleted region are dropped with it:

| Element | Action |
|---|---|
| `w:ins`, `w:moveTo` (content containers) | unwrap |
| `w:del`, `w:moveFrom` (content containers) | remove |
| `w:*RangeStart/End` for moves | remove |
| `w:*PrChange`, `w:tblGridChange`, `w:numberingChange` | remove |
| `w:rPr/w:ins` under `w:pPr` | remove marker |
| `w:rPr/w:del` under `w:pPr` | merge with next `w:p` (Req 11.3) |
| `w:rPr/w:ins` or `w:rPr/w:del` elsewhere | remove marker (`w:del`: also warning `run-mark-del-accepted`) |
| `w:trPr/w:del` | remove `w:tr` |
| `w:tcPr/w:cellDel` | remove `w:tc` + warning |
| `w:trPr/w:ins`, `w:tcPr/w:cellIns`, `w:tcPr/w:cellMerge` | remove marker (+ warning for merge) |

Whether `w:ins`/`w:del` is a container or a marker is decided by its parent: under `w:rPr`, `w:trPr` or `w:tcPr` it is a marker. Anywhere else it is a container.

## Data Models

### Proposed change to types.ts

These are additive and optional, so existing implementations still compile.

```ts
export interface PlatformAdapters {
  /** Decode PNG/JPEG pixels. Contract: display orientation (EXIF Orientation applied), no colour-space
   *  conversion, non-premultiplied RGBA. Browser: createImageBitmap(blob, { imageOrientation: 'from-image',
   *  colorSpaceConversion: 'none', premultiplyAlpha: 'none' }) + OffscreenCanvas; Node: pngjs/jpeg-js + rotation. */
  decodeImage?(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>;
  /** Encode RGBA to PNG/JPEG. JPEG quality is 0.92. The output must carry no metadata beyond what the encoder requires. */
  encodeImage?(img: { width: number; height: number; rgba: Uint8ClampedArray }, mime: 'image/png' | 'image/jpeg'): Promise<Uint8Array>;
  /** NEW (shared with pdf-ghosts). Render 1-based `page` of `pdf` at `scale` (1 = 72 DPI), applying /Rotate and
   *  the CropBox and skipping Hidden/NoView annotations. Must not mutate `pdf`. Browser: pdfjs-dist in the worker
   *  with OffscreenCanvas; Node: pdfjs-dist + @napi-rs/canvas. */
  rasterizePdfPage?(pdf: Uint8Array, page: number, opts: { scale: number; signal?: AbortSignal }):
    Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>;
}

export interface ExtractContext {
  // ...existing members...
  /** NEW. Re-enter the exorcist registry for nested files (DOCX → JPEG). Depth + 1, max 3, same signal.
   *  Resolves with an empty output and a warning instead of throwing. */
  exorciseNested?(bytes: Uint8Array, ctx: ExtractContext, opts: ExorciseOptions): Promise<Omit<Exorcism, 'verification'>>;
}
```

`exorciseNested` is optional because extractors never need it. The pipeline always provides it to exorcists. Without it, the DOCX exorcist would have to import the registry, which would create an import cycle with the lazy registry entry.

### removes() per format

| Exorcist | removes |
|---|---|
| png | trailing-data, recovered-image, embedded-thumbnail, gps-location, device-identity, software-trail, capture-time, author-identity, icc-profile-identity |
| jpeg | same as png |
| pdf | pdf-metadata, author-identity, software-trail, capture-time, prior-revision, unredacted-text, hidden-annotation, embedded-file |
| docx | tracked-change, comment, revision-id, docx-properties, author-identity, embedded-media-ghost (+ hidden-text, alt-text if the docx-ghosts type change lands; Req 13.6) |

`text-in-pixels` is in no `removes` list. Visible pixels are what the user chose to share, so that kind is never claimed as removable.

### Mode selection (images)

| reencode | adapters | APNG | E | Mode |
|---|---|---|---|---|
| true | both | no | = removes | re-encode → allowlist strip |
| true | both | no | ⊂ removes | subset strip (re-encoding would destroy kinds the user kept) + warning `reencode-skipped-subset` |
| true | missing | — | any | strip + `reencode-unavailable` |
| true | both | yes | any | strip + `apng-chunk-strip` |
| false | — | — | = removes / ⊂ removes | allowlist strip / subset strip |

### Warning codes added by this spec

| Code | Where | Meaning shown to user |
|---|---|---|
| `kind-not-removable`, `invalid-option`, `nothing-to-remove` | pipeline | — |
| `collateral-removal` | pipeline | "Also removed: capture time (stored together with GPS)" |
| `ghost-survived`, `verification-incomplete` | pipeline | makes the result `residual` |
| `output-kind-mismatch` | pipeline | failure |
| `redactions-not-flattened` | pipeline | redaction text kept by request |
| `reencode-unavailable`, `reencode-skipped-subset`, `apng-chunk-strip`, `icc-dropped`, `bit-depth-reduced`, `palette-expanded` | png | — |
| `png-unrepairable`, `jpeg-unrepairable` | png/jpeg | failure |
| `mpf-secondary-dropped` | jpeg | HDR/portrait data removed |
| `pdf-encrypted` | pdf | failure |
| `signature-invalidated`, `page-rasterized`, `rasterize-unavailable` | pdf | — |
| `cell-deletion-accepted`, `cell-merge-accepted`, `run-mark-del-accepted` | docx | — |
| `media-unsupported`, `media-exorcism-failed`, `embedding-unchecked`, `macros-present`, `customxml-present` | docx | listed under "What we can't see" |

## Error Handling

- Every exorcist body runs inside the pipeline's guard. A throw or rejection becomes `exorcism-failed` with an empty output. pdf-lib's `EncryptedPDFError` is mapped to `pdf-encrypted`. JSZip load errors are mapped to `exorcism-failed` with the message "not a readable DOCX package".
- An exorcist never returns a partially written file. Either serialization completes and the output is checked by `sniff` and verification, or the output is empty.
- Abort: exorcists check `ctx.signal` between pages, parts and media entries. On abort they return an empty output, and the pipeline reports `aborted`.
- Nested media failures are contained per entry (Requirement 14.3). They never fail the whole DOCX.
- The final self-checks (`validateOpc` for DOCX; one `startxref` for PDF) run before the output is returned. A failure becomes `exorcism-failed`, so no corrupt file is ever offered for download.

## Correctness Properties

Arbitraries come from the-paw (`paw/arbitraries.ts`, `paw/mutations.ts`). Below, a "curse" of format X is `build(r)` for `r` from the-paw's planting recipe arbitrary for X, and `arbAnyFile` is the-paw's `hostileInputArb`. Property 3 is the per-exorcist form of the-paw's G3 property. Properties run with the Node reference adapters unless stated.

- **Property 1 (G2, no mutation)**: For any input `b` (any curse or `arbAnyFile`) and any options, `b` after `await exorcise(b, opts)` deep-equals a copy taken before the call. The same holds when calling each `exorcist.exorcise` directly, without the pipeline's copy.
- **Property 2 (no aliasing)**: For any `b`, `exorcise(b).output.buffer !== b.buffer`, and writing `0xFF` to every byte of `output` leaves `b` unchanged.
- **Property 3 (G3, nothing survives)**: For any curse `f` of kind X with planted kinds `K`, and default options, `verification.ghosts.filter(g => E.includes(g.kind))` is empty, `summarizeExorcism` is not `'residual'` because of `ghost-survived`, and `banished` contains every `k ∈ K ∩ E`.
- **Property 4 (honest verification)**: For any `f`, `exorcise(f).verification` deep-equals `inspect(exorcise(f).output)` after removing `durationMs`.
- **Property 5 (banished accounting)**: For any `f` and options, the kinds in `banished` ⊆ `E`, are in canonical order, have no duplicates, and every `count === count_prior(kind) > 0`. No kind appears both in `banished` and in a `ghost-survived` warning.
- **Property 6 (secret needle)**: For any curse in which a random 16-character token `τ` (`[A-Za-z0-9]`) is planted in a field that a removed ghost reports, `τ` occurs neither in `output` (as UTF-8, UTF-16LE or UTF-16BE) nor in any decompressed container of the output: PNG zTXt/iTXt/iCCP, PDF FlateDecode streams, DOCX ZIP entries.
- **Property 7 (same format)**: For any `b`, if `output.length > 0` then `sniff(output) === sniff(b)`.
- **Property 8 (PNG strip keeps pixels exactly)**: For any PNG curse with `reencode: false`, the concatenation of `IHDR`, `PLTE`, `tRNS` and `IDAT` chunk bytes in the output equals that of the input, every output chunk type is in `PNG_KEEP`, and the output ends exactly at `IEND`'s CRC.
- **Property 9 (PNG re-encode lossless)**: For any 8-bit, non-APNG PNG curse with `reencode: true`, the decoded RGBA of the output equals the decoded RGBA of the input (Node adapter; see Testing Strategy for the browser caveat).
- **Property 10 (JPEG strip keeps scans and orientation)**: For any JPEG curse with `reencode: false`, the DQT, DHT, SOFn, DRI, SOS and entropy-coded bytes are byte-identical in order, `orientation(output) === orientation(input)` (1 when absent), and any APP1 in the output equals `orientationApp1(o)`.
- **Property 11 (JPEG re-encode geometry)**: For any JPEG curse with orientation `o` and `reencode: true`, the output's SOF dimensions equal the display dimensions of the input, and the PSNR between decoded output and decoded input (display oriented) is ≥ 30 dB for the smooth-content arbitrary.
- **Property 12 (idempotence)**: For any PNG or JPEG curse in strip mode, `exorcise(exorcise(f).output)` has an empty `banished` and an output byte-identical to its input. For any PDF or DOCX curse, the second exorcism has an empty `banished`.
- **Property 13 (PDF structure)**: For any PDF curse:
  - the output has exactly one `startxref`;
  - the trailer has neither `/Info` nor `/ID`;
  - the catalog has none of `/Metadata`, `/PieceInfo`, `/AF`, `/Collection` or `/Names /EmbeddedFiles`;
  - no annotation has `/F & 34 ≠ 0` or a subtype other than `/Link` or `/Widget`;
  - every indirect object is reachable from `/Root`.
- **Property 14 (PDF shape preserved)**: For any PDF curse, the output's page count equals the input's, and for every page not rasterized the CropBox width and height are equal to within 0.5 pt.
- **Property 15 (PDF fake redactions destroyed)**: For any PDF curse with planted text under an opaque rectangle on page set `R`, with the Node rasterize adapter, `pdfjs getTextContent()` of every page in `R` in the output is empty, every other page's text equals the input's, and the planted text is absent per Property 6.
- **Property 16 (DOCX acceptance model)**: For any document model `M` (paragraphs of runs tagged normal, ins, del, moveFrom or moveTo, optional deleted or inserted paragraph marks, optional table rows marked deleted), the visible text of `exorcise(docx(M))` (concatenating `w:t` per paragraph, paragraphs joined by `\n`) equals `acceptText(M)`, a 30-line reference model in the test.
- **Property 17 (DOCX cleanliness)**: For any DOCX curse with default options:
  - no part contains `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, any `*PrChange`, `w:commentRangeStart`, `w:commentRangeEnd`, `w:commentReference`, `w:rsids` or `w:trackRevisions`;
  - no attribute's local name starts with `rsid`;
  - no `word/comments*.xml`, `word/people.xml` or `docProps/*` entry exists;
  - `validateOpc` returns no warnings.
- **Property 18 (DOCX ZIP hygiene)**: For any DOCX curse, every local and central header in the output has DOS time `0x0000` and date `0x0021`, there are no `0x5455`/`0x000A` extra fields, the archive comment is empty, and the entry order equals the input order with deleted entries removed.
- **Property 19 (nested media)**: For any DOCX curse with `n ∈ [1, 5]` embedded PNG/JPEG images carrying GPS or serial ghosts, `verification` has no `embedded-media-ghost`, and the set of `word/media/*` names is unchanged.
- **Property 20 (naming)**: For any string `s` and kind `k`, `cleanFileName(s, k)` matches `/\.clean\.[A-Za-z]+$/`, contains no `/`, `\`, U+0000–U+001F or `<>:"|?*`, is ≤ 255 UTF-8 bytes, is not lone-surrogate-broken, and is idempotent.
- **Property 21 (never reject)**: For any `b` from `arbAnyFile` and any options from `arbExorciseOptions` (including invalid ones from untyped callers), `exorcise` resolves and `ExorcismSchema.safeParse` succeeds.
- **Property 22 (subset)**: For any curse and any non-empty `K ⊆ removes(X)`, with `opts.kinds = K`, the verification has no ghost of a kind in `K`, and the kinds in `banished` ⊆ `K`.

## Testing Strategy

- **Unit tests**:
  - `orientationApp1(6)`: exact bytes;
  - `neutralJfif`: exact bytes;
  - PNG allowlist on a file with every chunk type in the PNG Third Edition;
  - JPEG strip with ExtendedXMP, MPF and Photoshop IRB;
  - PDF GC on a 3-revision fixture (object counts before and after);
  - annotation flag matrix (each of the bits 1–10 alone);
  - Widget pruning from nested AcroForm fields;
  - DOCX paragraph-mark merge chains of 1–3 paragraphs;
  - `w:cellDel`;
  - author-only anonymization;
  - `cleanFileName` on a table: `IMG_0001.JPG` → `IMG_0001.clean.JPG`; `scan` (pdf) → `scan.clean.pdf`; `photo.txt` (jpeg) → `photo.clean.jpg`; `.hidden` (png) → `.hidden.clean.png`; `a.clean.png` → `a.clean.png`; `C:\Users\Ada\x.docx` → `x.clean.docx`; a 300-byte emoji name.
- **Property tests**: Properties 1–22 in `orchestrator/exorcise.prop.test.ts`, `exorcists/*/index.prop.test.ts` and `naming.prop.test.ts`. The PDF rasterization properties (14, 15) need `@napi-rs/canvas` and run in the `core:heavy` CI job with `numRuns: 25`.
- **Fixtures** are generated in `fixtures/haunted-gallery/exorcism/` with synthetic people (Ada Quill, Corwin Vale):
  - `fake-redaction.pdf`: black rectangles over "Corwin Vale, 14 Larkspur Row";
  - `three-revisions.pdf`;
  - `annotated.pdf`: a hidden sticky note plus an attachment;
  - `negotiation.docx`: ins, del, moves, a deleted paragraph mark, comments, rsids, docProps and a GPS JPEG in `word/media`;
  - `oriented-6.jpg`;
  - `apng.png`.

  Each has a golden "after" summary (banished counts, warning codes), not golden bytes, so that pdf-lib and jszip upgrades don't make the tests flaky.
- **Manual compatibility check** (listed in `docs/DEMO_SCRIPT.md`): open every exorcised gallery DOCX in Word 365 and LibreOffice 24.x and every PDF in Acrobat Reader and pdf.js. The task is done when nothing reports a repair or error. Automated stand-in: `validateOpc` plus re-parsing every XML part with xmldom in strict mode.
- **Browser adapter caveat**: canvas stores premultiplied alpha, so a PNG re-encode in the browser can change the RGB of semi-transparent pixels by a level or two. Property 9 therefore uses the Node adapter. A Playwright check asserts the browser result is within ±2 per channel on the gallery PNGs.
- **Dependencies**: `pdf-lib`, `jszip` and `pdfjs-dist` (existing, all lazy). Proposed additions: `@xmldom/xmldom` (DOCX XML in workers, lazy with jszip); `pngjs`, `jpeg-js` and `@napi-rs/canvas`, used only by the Node reference adapters in `@palimpsest/core/node-adapters`, which the MCP server and the tests use.
