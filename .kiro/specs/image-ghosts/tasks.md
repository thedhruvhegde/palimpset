# Implementation Plan

> Items marked [x] were implemented with Claude Code before the first Kiro session (see docs/PROVENANCE.md). Everything else is built in Kiro.

- [ ] 1. Checksums, inflate and the preview encoder
  - [ ] 1.1 Implement `util/crc32.ts` and `util/adler32.ts`, tested against RFC 1950 and PNG spec test vectors.
  - [ ] 1.2 Write Property 5 first, then implement `util/inflate.ts`: `inflateZlib`, plus `inflateRawTracked` with the known-mask, the unknown window and the decompression meter.
  - [ ] 1.3 Implement `util/png-encode.ts` (`encodePngStored`) and `util/downscale.ts`. Add a round-trip test that decodes the output with `inflateZlib` and checks pixels and alpha.
  - _Requirements: 3.4, 3.7, 3.12, 11.1_

- [ ] 2. PNG walker
  - [ ] 2.1 Add `arbChunkList` (random chunk lists serialized through the-paw's `paw/gen/png-writer.ts`) next to the walker tests. Use the-paw's PNG recipe arbitrary as `arbPng`.
  - [x] 2.2 Write Property 1 and the edge-case unit tests, then implement `extractors/png/walk.ts`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [ ] 3. Shared trailing-data detection
  - [x] 3.1 Implement `shared/trailing.ts` (`classifyTrailing`, `trailingGhost`) with the class order, severity and fields from Requirement 2. Add unit tests per class.
  - [x] 3.2 Add the PNG extractor skeleton (`extractors/png/index.ts`) with `detects` from 13.2 and trailing data only. Register it in the default registry.
  - [ ] 3.3 Add Property 2 and Property 9 (the class part, without acropalypse yet).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 13.2_

- [ ] 4. Nested trailing files
  - [ ] 4.1 Wire `embedded-file` trailing data through `ctx.inspectNested` and `nestGhosts`, with severity raise-up. For embedded PNG/JPEG, emit a `recovered-image` ghost with the original bytes as the preview.
  - [ ] 4.2 Add unit tests for an appended JPEG and for an appended PDF (sniff only).
  - _Requirements: 2.4, 2.6, 3.10_

- [ ] 5. aCropalypse: stream rebuild and block search
  - [ ] 5.1 Add `paw/gen/deflate-dynamic.ts`, a test-only deflate encoder that emits dynamic and stored blocks at chosen boundaries and records each boundary's bit offset. It complements the-paw's stored and fixed-literal `deflate.ts`.
  - [ ] 5.2 Implement `acropalypse/idat-tail.ts`, with tests for a tail that starts mid-chunk, a tail with no IDAT header, and a tail with a corrupt CRC.
  - [ ] 5.3 Implement `isPlausibleBlockHeader` and `acropalypse/block-search.ts` (64 full-decode cap, fixed Huffman off). Add Property 6.
  - _Requirements: 3.2, 3.3, 3.4, 3.12_

- [ ] 6. aCropalypse: alignment, unfilter and recovery
  - [ ] 6.1 Implement `acropalypse/align.ts` with the screen-width list and scoring from the end. Add Property 8.
  - [ ] 6.2 Implement `acropalypse/unfilter.ts` with known propagation for filters 0–4, unit-tested per filter type with hand-computed rows.
  - [ ] 6.3 Implement `recover.ts` (`recoverPngTail`). Add a test-only `arbForgedScreenshot`: the-paw's aCropalypse composition, plus a `CompressionStream` variant for dynamic blocks. Add Property 7.
  - _Requirements: 3.1, 3.5, 3.6, 3.9_

- [ ] 7. aCropalypse: ghost and preview
  - [ ] 7.1 Emit the `recovered-image` ghost (fields, raw, confidence formula, severity) using `encodePreview` (adapter first, stored fallback, size caps). On failure, emit `acropalypse-unrecoverable` and add `recovered-image` to `unchecked`.
  - [ ] 7.2 Generate the `acropalypse-pixel.png` and `snipping-tool.png` fixtures. Add example tests (`knownRatio ≥ 0.8`, marker row present).
  - _Requirements: 3.7, 3.8, 3.9_

- [ ] 8. JPEG walker and MPF
  - [ ] 8.1 Use the-paw's JPEG recipe arbitrary as `arbJpeg`. Add a test-only progressive variant (SOF2 with several SOS scans built through segment injection).
  - [ ] 8.2 Write tests (fill bytes, RST markers, an EOI inside APP1, truncation, garbage), then implement `extractors/jpeg/walk.ts`, including `parseMpf`.
  - [ ] 8.3 Add the JPEG extractor skeleton with trailing data (including the `mpf` and `jpeg-entropy-tail` classes, plus `jpeg-tail-not-reconstructed`). Register it. Add Properties 3 and 4.
  - _Requirements: 2.1, 2.3, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 9. Exif writer and exifr integration
  - [ ] 9.1 Extend the-paw's `paw/gen/tiff-writer.ts` only where needed: UCS-2LE XP tags, the MakerNote tag, and IFD1 uncompressed-strip thumbnails.
  - [ ] 9.2 Implement `shared/exif.ts`: `runExifr` with the pinned options and a dynamic import, and input slicing per format. Map results to `Finding`s. On failure, emit `exif-parse-failed` and add the listed kinds to `unchecked`.
  - [ ] 9.3 Implement `shared/findings.ts` (grouping per container, chunk locations) and the table-driven `shared/severity.ts` with tests.
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 13.1_

- [ ] 10. GPS
  - [ ] 10.1 Implement DMS and XMP GPS parsing, validity checks, the zeroed/invalid ghost, textual-place ghosts and the summary/fields format. Add Property 10.
  - [ ] 10.2 Write `scripts/build-gazetteer.ts` (local input path only), generate and commit `geo/cities.generated.ts`, implement `geo/gazetteer.ts` with a lazy load, and add Property 11 and the `formatPlace` tests.
  - [ ] 10.3 Fill `Place (offline)` in the GPS ghost, with the `gazetteer-unavailable` fallback.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 11. Device, author, software and capture time
  - [ ] 11.1 Map the Exif and IPTC tags for device identity, with serial masking and the MakerNote ghost. Add Property 12.
  - [ ] 11.2 Map the author, software-trail and capture-time tags (including the UTC offset field and the modify-only wisp), and the COM-segment ghost with banner detection.
  - _Requirements: 4.7, 5.7, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4_

- [ ] 12. XMP reader
  - [ ] 12.1 Extend the-paw's `paw/gen/xmp-writer.ts` with random prefixes, attribute and element forms, Seq/Bag/Alt, History events and an ExtendedXMP split.
  - [ ] 12.2 Implement `shared/xmp/read.ts` (tokenizer, namespace stack, ExtendedXMP join by GUID and offset) and `shared/xmp/map.ts`. Add Property 15.
  - _Requirements: 5.3, 6.2, 6.5, 7.1, 8.1, 8.2, 8.3_

- [ ] 13. Embedded thumbnails
  - [ ] 13.1 Implement `extractors/jpeg/thumbnails.ts`: IFD1 JPEG thumbnails with absolute ranges and SOF dimensions; JFIF, JFXX and IRB thumbnails; uncompressed IFD1 without preview; the out-of-range warning; aspect-ratio severity. Reuse it for the PNG `eXIf` IFD1.
  - [ ] 13.2 Add Property 13 and the `thumb-precrop.jpg` fixture.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ] 14. ICC profiles
  - [ ] 14.1 Extend the-paw's `paw/gen/icc-writer.ts` with v4 `mluc` descriptions and `dmnd`/`dmdd` tags.
  - [ ] 14.2 Implement `shared/icc.ts`: parser, standard list, JPEG APP2 reassembly by sequence, PNG `iCCP` via `inflateZlib`, and `icc-incomplete`. Add Property 16.
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 15. PNG text chunks and remaining PNG metadata
  - [ ] 15.1 Implement `extractors/png/text.ts`: tEXt, zTXt and iTXt decoding, keyword mapping, XMP hand-off, "Raw profile type" hex decoding, and bad keyword/zlib warnings.
  - [ ] 15.2 Wire `eXIf` into exifr and `tIME` into capture time. Add Property 14.
  - _Requirements: 5.2, 8.3, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ] 16. HEIC extractor
  - [ ] 16.1 Add `paw/gen/heic-writer.ts`, a synthetic HEIC writer (`ftyp`, `meta` with `iinf`/`iloc`/`iref`, an Exif item, an XMP item, `colr prof`, and a `thmb` reference to a dummy item).
  - [ ] 16.2 Implement `extractors/heic/isobmff.ts` (`walkIsobmff`, `resolveItems`) with tests for `largesize`, size 0 and malformed boxes.
  - [ ] 16.3 Implement `extractors/heic/index.ts` (metadata via exifr with item locations, the `heic-location-approx` fallback, trailing data, a thumbnail ghost without preview). Register it.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.2_

- [ ] 17. Robustness and completeness suites
  - [ ] 17.1 Wrap every section in a guard (`<section>-parse-failed`) and add `signal` checks. Add Property 17 (fuzz plus mutated gallery) and the time-budget assertion.
  - [ ] 17.2 Using the-paw's `arbImageCurse(K)`, add Property 18 (G4) and Property 19. Check that the-paw's `NOT_PLANTABLE` lists `text-in-pixels` and (until the HEIC writer is adopted) `heic`.
  - _Requirements: 2.7, 13.1, 13.3, 13.4_

- [ ] 18. GPS display in the web app
  - [ ] 18.1 Implement `apps/web/src/ui/gps-evidence.ts` (coordinates, place, and the opt-in button with the exact label).
  - [ ] 18.2 Implement `apps/web/src/ui/opt-in-map.ts` (`tileFor`, a 3×3 grid at zoom 15, `referrerpolicy="strict-origin"`, attribution, a local CSS marker, no persistence). Add Property 20.
  - [ ] 18.3 Add the lint rule restricting `tile.openstreetmap.org`, and the Playwright tests: zero requests before the click, exactly 9 after, none after a reload.
  - _Requirements: 6.8, 6.9, 6.10, 6.11_
