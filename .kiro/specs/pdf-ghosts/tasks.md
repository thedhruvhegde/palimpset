# Implementation Plan

Prerequisites: from the ghost-model-and-ingest spec, `formats/sniff.ts`, `schema.ts` (`ExtractResultSchema`), the registry and `nested.ts` (`nestGhosts`); from the-paw, tasks 1–3 (byte helpers, the image writers and `paw/gen/pdf-writer.ts`), plus task 5 (`build`, recipe and mutation arbitraries) before any property-test subtask. Every task leaves `npm run typecheck`, `npm test` and `npm run test:paw` green.

- [ ] 1. Shared helpers and proposed adapter
  - [ ] 1.1 Make sure `PlatformAdapters.rasterizePdfPage` exists in `packages/core/src/types.ts`, in the shape proposed here and in the exorcism spec. Add it if the exorcism work hasn't yet. Add a `types.test.ts` case asserting that adapters without it still type-check. Let the `types-changed` hook update the other specs.
    - _Requirements: 4.11, 5.4, 9.6_
  - [ ] 1.2 Write tests first for `extractors/shared/pii-patterns.ts` (email, phone, national-ID-shaped digits, street address, with negative cases such as dates and prices), then implement it.
    - _Requirements: 4.9_
  - [ ] 1.3 Write tests first for `extractors/shared/image-dimensions.ts` (PNG IHDR, JPEG SOF0/SOF2 after APPn, truncated input returns null), then implement it.
    - _Requirements: 8.3_
  - [ ] 1.4 Implement `pdf-dates.ts` with unit tests for full dates, partial dates, `Z`/`+hh'mm'` offsets and garbage (which returns the raw string).
    - _Requirements: 6.1_

- [ ] 2. Raw-byte scanner
  - [ ] 2.1 Write `raw-scan.test.ts` with hand-made byte strings: one revision; two revisions with LF, CR and CRLF endings; a `%%EOF` inside a stream; a broken `startxref`; a `/Prev` loop; a linearized header; `/Encrypt`; an uncompressed XMP packet; leading junk before `%PDF-`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8_
  - [ ] 2.2 Implement `scanPdfStructure`: the forward `%%EOF` matcher, bounded backward `startxref` search, xref target validation, linearization flag, `/Encrypt` detection, XMP packet ranges and the `objectIndex`.
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8_
  - [ ] 2.3 Implement the `/Prev` chain walk for classic trailers and xref stream dictionaries, with the 1,024-step bound and a visited set. Mark boundaries `confirmed`.
    - _Requirements: 3.4_
  - [ ] 2.4 Add property tests 8 (revision count, scanner half), 10 (linearization) and 14 (scanner never throws, linear steps) using the Paw PDF writer and its mutation arbitrary.
    - _Requirements: 3.1, 3.3, 3.4, 3.7_

- [ ] 3. pdf.js loading and extractor skeleton
  - [ ] 3.1 Implement `pdfjs-loader.ts`: `setPdfjsLoader`, a memoized `loadPdfjs` (dynamic import of the legacy build), and `openDocument` with the safe options from Requirement 2.2 and `bytes.slice()`. Map `PasswordException` to `reason: 'password'`. Test it: the input `byteLength` is unchanged after open and destroy, and a password-protected sample returns `reason: 'password'`.
    - _Requirements: 1.2, 1.4, 2.1, 2.2, 2.3_
  - [ ] 3.2 Create `index.ts` with `extractor` (`kind`, `detects`), the detector runner (try/catch per detector, id numbering `${kind}:${n}`, merging `unchecked`), the catch-all, and `budget-exceeded` handling on `ctx.signal`. Register it lazily (`{ kind: 'pdf', load: () => import('./extractors/pdf') }`) in the core registry. Add a test that an empty or garbage input returns warnings and every kind in `unchecked` without throwing.
    - _Requirements: 1.1, 1.5, 1.6, 2.4, 2.5, 9.3_
  - [ ] 3.3 Wire the encrypted paths: password required, and owner-password-only. The raw-scan fallback keeps `prior-revision`. Add tests with writer-generated samples: `encrypt: 'locked'` (a standard-handler `/Encrypt` with a random `/U`, so the empty password fails) and `encrypt: 'owner-only'` (RC4-40, R2, empty user password).
    - _Requirements: 9.1, 9.2, 9.3_
  - [ ] 3.4 Add property test 15 (extractor never throws and never mutates, output passes the zod schema).
    - _Requirements: 1.6, 2.1_

- [ ] 4. Geometry
  - [ ] 4.1 Write tests first, then implement `geometry.ts`: matrix ops, `quadAabb`, `isAxisAligned`, `intersect`, the exact `unionArea` sweep and `coverage`.
    - _Requirements: 4.5_
  - [ ] 4.2 Add property tests 1 (coverage bounds), 2 (monotonicity) and 3 (exact union area).
    - _Requirements: 4.5_

- [ ] 5. Operator replay
  - [ ] 5.1 Implement `op-normalize.ts` for pdf.js 6.5.438: decode `constructPath` (`[paintOp, [Float32Array DrawOPS], minMax]`), read fill colors from hex strings or byte triplets (gray and CMYK converted to RGB), and handle gstate `ca`/`SMask`/`BM`, form begin and end, annotation begin and end, and images. Add `op-normalize.shape.test.ts`, the shape lock.
    - _Requirements: 4.1, 4.2, 4.3, 4.7_
  - [ ] 5.2 Implement `page-replay.ts`: the graphics stack, the text state machine, glyph advance (including TJ numbers, `Tc`, `Tw`, `Tz`, `Ts`), glyph quads from font ascent and descent (with defaults), line counting, cover extraction with opacity, Redact annotation covers with `opIndex = Infinity`, stats, and a signal check every 5,000 operators. Unit tests cover TJ kerning, horizontal scaling, rotation, nested `q`/`Q` and a form XObject matrix.
    - _Requirements: 2.5, 4.1, 4.2, 4.3, 4.7_
  - [ ] 5.3 Add property test 4 (replay matches the reference text-matrix formula).
    - _Requirements: 4.1_

- [ ] 6. Unredacted-text detector
  - [ ] 6.1 Implement `findHiddenSpans`: the later-cover filter, the 0.60 threshold, line and gap span merging, dropping whitespace-only spans. Unit tests use synthetic `GlyphBox`/`Cover` arrays.
    - _Requirements: 4.4, 4.5, 4.6_
  - [ ] 6.2 Implement `redaction.ts`'s ghost drafting: the confidence table, PII severity, the fields, U+FFFD with `pdf-no-unicode`, scanned-page and outline-text warnings, page and op limits, and the `getTextContent` fallback with `pdf-replay-fallback`.
    - _Requirements: 4.6, 4.8, 4.9, 4.10, 4.12, 4.13, 9.4, 9.5_
  - [ ] 6.3 Add property tests 5 (a later opaque cover detects), 6 (no ghost from earlier, translucent or thin covers) and 7 (threshold edge).
    - _Requirements: 4.4, 4.5, 4.6_
  - [ ] 6.4 Implement `render.ts`'s `regionIsUniform` and `channelStdDev` (user-space to pixel mapping with y flipped), and the confidence adjustment. Test with a fake `rasterizePdfPage` returning fixed RGBA. With no adapter, the result is the `preview-unavailable` warning.
    - _Requirements: 4.8, 4.11, 9.6_

- [ ] 7. Prior revisions
  - [ ] 7.1 Implement `detectPriorRevisions` without previews: one ghost per prior boundary, locations, revision and byte-range fields, confidence from `confirmed`, and `pdf-revision-unreadable` handling.
    - _Requirements: 5.1, 5.2, 5.7, 5.8_
  - [ ] 7.2 Add the page comparison (count, normalized text, operator hash), `Text removed since`, changed-object classification for severity, and the 32-revision cap with `pdf-revisions-truncated`.
    - _Requirements: 5.3, 5.5, 5.6_
  - [ ] 7.3 Add `renderPagePreview` for the first differing page (≤ 1,024 px wide, encoded through `encodeImage`), tested with fake adapters.
    - _Requirements: 5.4_
  - [ ] 7.4 Add property tests 8 (the extractor half: ghost count, indices, contiguous ranges) and 9 (prefix validity).
    - _Requirements: 5.1, 5.2_

- [ ] 8. Metadata
  - [ ] 8.1 Implement `detectMetadata`: Info ghost, XMP ghost, stray XMP packets from the raw scan, `author-identity` for `/Author` and `dc:creator`, `software-trail` and `capture-time` derived ghosts, severity rules, and location lookup through `objectIndex` with a trailer fallback.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [ ] 8.2 Add property test 11 (metadata round-trip).
    - _Requirements: 6.1, 6.2, 6.4_

- [ ] 9. Annotations and hidden layers
  - [ ] 9.1 Implement `detectHiddenAnnotations`: the flag predicate, named flags, fields, severity, no `author-identity` emission, and the `pdf-hidden-layer` warning from `getOptionalContentConfig`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [ ] 9.2 Add property test 12 (annotation flag predicate).
    - _Requirements: 7.1_

- [ ] 10. Embedded files
  - [ ] 10.1 Implement `detectEmbeddedFiles`: the name tree plus FileAttachment annotations, de-duplication, fields, the PNG/JPEG preview passthrough using `imageDimensions`, nested inspection through `ctx.inspectNested(content, ctx)` with `nestGhosts` wrapping (no duplicate warning or unchecked propagation; the orchestrator does that), and the `Ghosts inside` field.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [ ] 10.2 Add property test 13 (attachment count and names).
    - _Requirements: 8.1, 8.2_

- [ ] 11. Integration
  - [ ] 11.1 In `apps/web/src/worker.ts`, call `setPdfjsLoader` with the Vite `?url` import of `pdf.worker.min.mjs` (same origin), and provide `rasterizePdfPage` (pdf.js `page.render` into an `OffscreenCanvas`, then `getImageData`). Add a build check that the initial chunk contains no `pdfjs-dist` code.
    - _Requirements: 1.3, 1.4, 2.2_
  - [ ] 11.2 Add the Haunted Gallery PDFs to `scripts/make-fixtures.ts` from fixed recipes, and add snapshot tests of their ghost lists (preview bytes hashed).
    - _Requirements: 4.6, 5.1, 6.1, 7.1, 8.1_
  - [ ] 11.3 Run every gallery PDF through the Playwright no-network test, and confirm zero foreign requests, including no CMap or standard-font fetches.
    - _Requirements: 2.2_
