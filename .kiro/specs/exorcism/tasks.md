# Implementation Plan

Prerequisites: `ghost-model-and-ingest` tasks 1–11 (orchestrator, registry, dispatch-only `exorcise`). The `image-ghosts` extractors are needed for the PNG/JPEG verification properties. `pdf-ghosts` (the extractor and its `unredacted-text` locations) is needed for PDF verification and rasterization. Until it lands, PDF tasks assert on structure directly (Properties 13 and 14), and Property 3 for PDF stays `it.todo`. Curses come from the-paw's recipe arbitraries.

- [ ] 1. Type additions and adapter contract
  - [ ] 1.1 Add `PlatformAdapters.rasterizePdfPage?` and `ExtractContext.exorciseNested?`, and update the `decodeImage`/`encodeImage` doc comments in `types.ts`, as in design.md "Proposed change to types.ts". Update `schema.ts` and its type test.
  - _Requirements: 6.2, 9.1, 14.1_

- [ ] 2. Output naming
  - [ ] 2.1 Write the table-driven tests and Property 20 first, then implement `naming.ts` (`cleanFileName`).
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [ ] 3. Pipeline: effective kinds and banished accounting
  - [ ] 3.1 Implement `effectiveKinds` (intersection, `rasterizeRedactions` exclusion, `kind-not-removable`) and `computeBanished` (banished, survived, collateral). Unit-test them with hand-built prior and verification pairs.
  - [ ] 3.2 Implement `summarizeExorcism`, with a truth-table test.
  - _Requirements: 1.5, 1.6, 1.8, 4.1, 4.2_

- [ ] 4. Pipeline: full orchestration
  - [ ] 4.1 Replace the dispatch-only `orchestrator/exorcise.ts` with the full sequence: options validation, prior reuse or inspection, the `E`-empty short-circuit, the private copy, the exorcist budget (×3), `exorciseNested` in the context, the output-kind check, verification, at most one second pass, warnings merge, and `ghost-survived` / `verification-incomplete` / `redactions-not-flattened`.
  - [ ] 4.2 Add stub exorcists in test-support (`leaky` leaves one ghost, `fixedOnSecondPass`, `mutating` writes to its input, `wrongKind`). Add Properties 1, 2, 4, 5, 7 and 21 against the stubs and the dispatch tests from ingest.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.9, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.3, 4.4, 4.5, 16.1, 16.4_

- [ ] 5. Reference Node adapters
  - [ ] 5.1 Implement `adapters/node.ts`: `decodeImage` with pngjs and jpeg-js plus EXIF orientation rotation, `encodeImage` (PNG through pngjs, JPEG through jpeg-js at quality 92), and a separate package entry. Unit-test orientation 1–8 on a 3×2 asymmetric image.
  - [ ] 5.2 Add `rasterizePdfPage(pdf, page, { scale, signal })` (1-based page, the shape shared with pdf-ghosts) with pdfjs-dist and `@napi-rs/canvas` in the same module, behind a lazy import. Coordinate with the-paw's `paw/node/adapters.ts` so there is one Node adapter set. Add a smoke test on a one-page fixture in the `core:heavy` job.
  - _Requirements: 6.2, 9.1, 9.2_

- [ ] 6. PNG exorcist: strip modes
  - [ ] 6.1 Write tests for the allowlist (every PNG Third Edition chunk type), the standard and non-standard `iCCP` decision, truncation after IEND, and `png-unrepairable`. Then implement `exorcists/png/strip.ts` in allowlist mode.
  - [ ] 6.2 Implement subset mode, driven by calling the PNG extractor's `extract` directly and dropping chunks that contain ghost start offsets.
  - [ ] 6.3 Register the PNG exorcist. Add Properties 8 and 12 (PNG part), and Properties 3 and 22 for PNG curses with `reencode: false`.
  - _Requirements: 5.1, 5.3, 5.4, 5.6, 5.7, 2.5_

- [ ] 7. PNG exorcist: re-encode
  - [ ] 7.1 Implement `reencode.ts` with the mode-selection table (APNG, missing adapters, subset) and the `bit-depth-reduced` / `palette-expanded` / `icc-dropped` warnings, followed by the allowlist strip.
  - [ ] 7.2 Add Property 9 (Node adapter). Add Property 6 for PNG curses, searching zTXt, iTXt and iCCP after inflating.
  - _Requirements: 5.2, 5.5, 5.6, 2.5_

- [ ] 8. JPEG exorcist: strip modes
  - [ ] 8.1 Write exact-byte tests for `orientationApp1(o)` and `neutralJfif`, then implement them.
  - [ ] 8.2 Implement `exorcists/jpeg/strip.ts` in allowlist and subset modes (ExtendedXMP grouped with XMP, ICC segments grouped together, MPF and trailing bytes dropped with `mpf-secondary-dropped`, `jpeg-unrepairable`).
  - [ ] 8.3 Register the JPEG exorcist. Add Properties 10 and 12 (JPEG part), and Properties 3 and 22 for JPEG curses with `reencode: false`.
  - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 2.5_

- [ ] 9. JPEG exorcist: re-encode
  - [ ] 9.1 Implement `exorcists/jpeg/reencode.ts` (display-oriented decode, quality 0.92, allowlist strip of the encoder output).
  - [ ] 9.2 Add Property 11 and Property 6 (JPEG part). Add the browser adapter in `apps/web/src/adapters.ts`, with a Playwright check on `oriented-6.jpg`.
  - _Requirements: 6.2, 2.5, 3.4_

- [ ] 10. PDF exorcist: rewrite, GC and metadata
  - [ ] 10.1 Generate the `three-revisions.pdf` fixture. Write the GC tests (objects from earlier revisions removed, reachable objects kept), then implement `pdf/gc.ts`.
  - [ ] 10.2 Implement `pdf/metadata.ts` (Info, ID, Metadata on every dictionary type, PieceInfo, LastModified, annotation `/M`), `pdf/signatures.ts` and the encrypted-PDF mapping.
  - [ ] 10.3 Implement `pdf/index.ts` (lazy pdf-lib load with `updateMetadata: false`, then metadata, GC, save with `useObjectStreams: false`, and the single-`startxref` self-check). Register it lazily. Add Property 13 (the metadata and revision parts).
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 16.1_

- [ ] 11. PDF exorcist: annotations and attachments
  - [ ] 11.1 Implement `pdf/annotations.ts` (subtype and flag rules, Popup cleanup, Widget and AcroForm pruning) and `pdf/attachments.ts` (EmbeddedFiles, AF, Collection, FileAttachment).
  - [ ] 11.2 Generate the `annotated.pdf` fixture. Add the flag-matrix unit tests, Property 13 (the annotation and attachment parts) and Property 14.
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 12. PDF exorcist: rasterize fake redactions
  - [ ] 12.1 Implement `pdf/rasterize.ts`: DPI with the 25 MP cap, page replacement at the same index with a rotated MediaBox and a PNG XObject, the `page-rasterized` and `rasterize-unavailable` warnings, and GC of the old page objects.
  - [ ] 12.2 Implement `pagesWithBadRedactions` by calling the pdf-ghosts extractor's `extract` directly (behind a feature check until that spec lands). Generate `fake-redaction.pdf`. Add Property 15 and Property 6 (PDF part) in `core:heavy`.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 13. DOCX package layer
  - [ ] 13.1 Add `@xmldom/xmldom`. Implement `docx/opc.ts` (load with jszip, record entry order and stored entries, parse content types and rels, `validateOpc`).
  - [ ] 13.2 Implement `docx/zip-write.ts` (order, DOS epoch timestamps, compression per entry, no comment, extra-field scrub). Add Property 18.
  - _Requirements: 13.3, 13.4, 13.5_

- [ ] 14. DOCX tracked changes
  - [ ] 14.1 Add `packages/core/test-support/docx-model.ts` (an arbitrary revision model `M`, a serializer to WordprocessingML through the-paw's `docx-writer`, and the `acceptText(M)` reference).
  - [ ] 14.2 Implement `docx/revisions.ts` per the design table (containers versus markers, paragraph-mark merge, table rows and cells, `w:trackRevisions`). Add Property 16 and the merge-chain unit tests.
  - [ ] 14.3 Implement `docx/anonymize.ts` (author-only mode, including `people.xml`), with unit tests.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ] 15. DOCX comments, rsids and properties
  - [ ] 15.1 Implement `docx/comments.ts` (part deletion, range and reference removal, emptied runs, rels and overrides).
  - [ ] 15.2 Implement `docx/rsid.ts` (namespace-exact `rsid*` attributes, `w:rsids`, conditional `w14:paraId`/`textId`) and `docx/props.ts` (docProps, the thumbnail, `attachedTemplate` and its rels).
  - [ ] 15.3 Register the DOCX exorcist lazily, with the final `validateOpc` self-check. Add Property 17, Property 12 (DOCX part) and Property 22 for DOCX.
  - _Requirements: 12.1, 12.2, 12.3, 13.1, 13.2, 13.4_

- [ ] 15a. DOCX hidden text and alt text (only once the docx-ghosts `types.ts` change lands)
  - [ ] 15a.1 Add `hidden-text` and `alt-text` to `removes(docx)`. Implement vanish-run removal (direct, character-style and paragraph-style `w:vanish`; `w:specVanish`) and alt-text attribute removal (`wp:docPr`, `pic:cNvPr`, `v:shape@alt`). Extend Property 17 and the needle property (Property 6) to cover both kinds.
  - _Requirements: 13.6_

- [ ] 16. DOCX embedded media
  - [ ] 16.1 Implement `docx/media.ts` using `ctx.exorciseNested` (same-kind check, the `media-unsupported` / `media-exorcism-failed` / `embedding-unchecked` / `macros-present` / `customxml-present` warnings).
  - [ ] 16.2 Generate `negotiation.docx`. Add Property 19, plus Properties 3 and 6 for DOCX curses (searching every inflated ZIP entry).
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 2.5_

- [ ] 17. G3 suite across formats
  - [ ] 17.1 Confirm that the-paw's G3 property runs over every registered exorcist (PNG, JPEG, DOCX, and PDF once pdf-ghosts lands) with default options and the Node adapters. Add any exorcism-specific `IDEMPOTENCE_MODES` justifications (strip mode is byte-idempotent; PDF and DOCX are banished-idempotent). Wire it into CI as the required "No ghost survives" check.
  - _Requirements: 2.5_

- [ ] 18. Web integration
  - [ ] 18.1 In `apps/web`, add the Exorcise action: send the `exorcise` worker request with `priorId`, download with `cleanFileName` through a `Blob` URL (the original `File` is untouched), show the "0 ghosts found in output" green check only for `clean`, and show the "Partly cleaned" state listing survivors for `residual`.
  - [ ] 18.2 Show HEIC as "could not exorcise", with a conditional "Convert to JPEG and exorcise" offer. Add Playwright tests for the clean, residual and failed states using gallery fixtures and the no-network assertion.
  - _Requirements: 1.8, 3.4, 15.1, 16.2, 16.3_
