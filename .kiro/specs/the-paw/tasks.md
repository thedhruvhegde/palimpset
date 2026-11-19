# Implementation Plan

Tasks 1–4 depend on nothing else. The pdf-ghosts and docx-ghosts specs list them as prerequisites. Tasks 6 onwards need the ghost-model-and-ingest core (`createCore`, registry, `schema.ts`, `computeBudget`, `nested.ts`). Property cases for formats without an extractor or exorcist are skipped with a reason, so every task leaves `npm run typecheck`, `npm test` and `npm run test:paw` green.

- [ ] 1. Foundations
  - [ ] 1.1 Move `fast-check` to `packages/core` dependencies, and add `pngjs` and `jpeg-js` as core devDependencies (pinned). Create `paw/bytes.ts` (ByteWriter, `crc32`, `adler32`, `fnv1a32`, base64, `sha256` through `crypto.subtle`), tested against published test vectors.
    - _Requirements: 1.1, 11.1, 12.3_
  - [ ] 1.2 Create `paw/synthetic.ts` (synthetic names, organisations, landmark coordinates and software strings, plus the token suffix scheme). Add a test that every entry passes the `haunted-asset-guard` rules (no real-person list matches, landmark coordinates only).
    - _Requirements: 1.10_
  - [ ] 1.3 Define `recipes.ts` and `manifest.ts` types. Write tests first for `matchesGhost` (every `LocationMatcher` variant, token normalisation, numeric tolerance, confidence floor) and `matchManifest` (Kuhn matching with duplicate kinds), then implement them.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [ ] 1.4 Add Paw self-property 6 (matching is injective and sound).
    - _Requirements: 2.5_

- [ ] 2. Image writers
  - [ ] 2.1 Implement `gen/deflate.ts` (`zlibStore`, `deflateStoredRaw`, `deflateFixedLiteralRaw`). Check the output against Node `zlib.inflateSync` and `inflateRawSync` in tests.
    - _Requirements: 1.2, 1.7_
  - [ ] 2.2 Implement `gen/png-writer.ts` (chunks, IDAT split, all ancillary chunks, the aCropalypse tail composition). Add a pngjs oracle test and an exact-bytes test for a 1×1 image.
    - _Requirements: 1.2, 1.3, 1.9_
  - [ ] 2.3 Implement `gen/jpeg-writer.ts` (the DC-only baseline encoder with Annex K tables, padding, segment injection, bytes after EOI). Add a jpeg-js oracle test (decoded block colours within ±2 of the recipe).
    - _Requirements: 1.4, 1.9_
  - [ ] 2.4 Implement `gen/tiff-writer.ts` (II/MM, IFD0, Exif and GPS IFDs, IFD1 thumbnail), `gen/xmp-writer.ts` and `gen/icc-writer.ts`. Round-trip through `exifr` in tests.
    - _Requirements: 1.5_

- [ ] 3. PDF writer
  - [ ] 3.1 Implement the `gen/pdf-writer.ts` object model and serialiser (classic xref, exact offsets, Helvetica AFM widths, text lines, filled rects with color and alpha through ExtGState), with a pdf.js oracle test (page count, extracted text).
    - _Requirements: 1.6, 1.9_
  - [ ] 3.2 Add incremental updates (`/Prev` chains), the xref-stream style and the linearized-style first-page section. Test that pdf.js opens every prefix that ends at a `%%EOF`.
    - _Requirements: 1.6_
  - [ ] 3.3 Add the Info dictionary, the XMP stream, annotations (`Text`, `FreeText`, `Square`, `Redact`, `FileAttachment`, with flags, `/T` and `/Contents`) and `EmbeddedFiles` attachments (raw bytes or nested image curses).
    - _Requirements: 1.6_
  - [ ] 3.4 Add `gen/md5-rc4.ts` and the `encrypt: 'locked' | 'owner-only'` modes. Test that pdf.js returns a password error for `locked` and opens `owner-only` with no password.
    - _Requirements: 1.6_

- [ ] 4. ZIP and DOCX writers
  - [ ] 4.1 Implement `gen/zip-writer.ts` (store and fixed deflate, a fixed DOS time, Zip64, entry order) and `writeZipHostile()` (duplicates, overlaps, understated sizes). Add a jszip oracle test and an `unzip -t`-style CRC check in Node.
    - _Requirements: 1.7, 1.9_
  - [ ] 4.2 Implement `gen/docx-writer.ts`: content types, rels, the main part with runs, tracked changes, comment anchors, hidden text (direct or by style), images with alt text, settings with rsids, comments and commentsExtended, people, docProps core/app/custom, customXml, nested DOCX embeddings, and standard or renamed prefixes. Add a jszip oracle test, plus a check that every XML part is well formed.
    - _Requirements: 1.8, 1.9_

- [ ] 5. Builders, planters and arbitraries
  - [ ] 5.1 Implement `build.ts` (`build(recipe)` returns `Curse`, with the manifest written from the writers' returned ranges and paths, and decoys) and `applyMutations`. Add Paw self-properties 1 (determinism), 3 (manifest locations in bounds) and 5 (mutation range safety).
    - _Requirements: 1.1, 2.1, 2.6, 10.3_
  - [ ] 5.2 Implement `arbitraries.ts` (`recipeArb` per format, `nestedDocxArb` with `fc.letrec` and max depth 3, `exorciseKindsArb`, and the `arbImageCurse` export for image-ghosts) and `mutations.ts` (`mutationArb`, `hostileInputArb`), following the shrinking rules: no `fc.chain`, per-mille positions, and a default planter fallback for `mustPlant`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [ ] 5.3 Add Paw self-properties 2 (oracle validity on generated recipes) and 4 (shrink closure).
    - _Requirements: 1.9, 10.1_
  - [ ] 5.4 Implement `planters.ts` (`PLANTERS`, `NOT_PLANTABLE` with reasons) and `coverage.test.ts`, which checks the contract against the registered extractors' `detects`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 6. Environment and comparison
  - [ ] 6.1 Implement `env.ts` (`PawEnv`, and `makeRegistryEnv` over `createCore`, the registry, `sniff` and `computeBudget`) and `node/adapters.ts` (pngjs and jpeg-js decode and encode).
    - _Requirements: 4.1, 5.1, 7.4_
  - [ ] 6.2 Implement `node/hard-deadline.ts` (a `worker_threads` worker that runs `inspect`, terminated at the deadline, returning `hang` or `crash`). Test it with a stub extractor that loops forever, registered in a test-only registry.
    - _Requirements: 7.5_
  - [ ] 6.3 Implement `canon.ts` and `idempotence.ts` (modes with justifications). Add Paw self-property 7 (ghost-equivalence is an equivalence).
    - _Requirements: 6.2, 6.3, 6.5_

- [ ] 7. The six properties
  - [ ] 7.1 Implement `properties.ts` with the `PawProperty` objects for P1 and P6, `PawFailure` detail (unmatched entries and nearest candidates), and `fingers.ts`.
    - _Requirements: 4.1, 4.2, 4.3, 9.1, 9.2, 9.3_
  - [ ] 7.2 Add P2 (kind subsets, unchecked check, verification ghost-equivalence, sniff check) and P3 (bytes or ghost-equivalent mode, dimension check, zero second banishment).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_
  - [ ] 7.3 Add P4 (hostile inputs, hard deadline, schema and invariants, duration bound) and P5 (offset view inside a larger buffer, canaries, detach check, output aliasing check).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4_
  - [ ] 7.4 Implement `runner.ts` (`caseSeed`, `planCases` with the run split and P4 doubling, `runCase` with progress events, `runPaw`), and add Paw self-property 9 (seed derivation is stable).
    - _Requirements: 12.2, 12.3, 12.5, 13.4_
  - [ ] 7.5 Write `paw.prop.test.ts`: one `it` per `CasePlan`, named with property, format and case seed, with `it.skip` plus a reason for missing extractors or exorcists, and the `[paw] base seed=…` banner. Read config from `node/config.ts` (`FC_NUM_RUNS`, `PAW_*`).
    - _Requirements: 12.1, 12.3, 12.4, 12.5, 12.8_

- [ ] 8. Counterexamples and regression
  - [ ] 8.1 Implement `counterexample.ts` (`CounterexampleSchema`, `serialize`, `parseCounterexample`, `$bytes` encoding). Add Paw self-property 8 (round-trip and hash).
    - _Requirements: 11.2, 11.5_
  - [ ] 8.2 Implement `node/reporter.ts` (`asyncReporter`: write `.json` and `.bin`, add the README placeholder line, print the replay command, write the `GITHUB_STEP_SUMMARY` table). Test it against a deliberately failing toy property in a temp directory.
    - _Requirements: 11.1, 11.6, 12.6_
  - [ ] 8.3 Write `regressions.test.ts` (part of `npm test`): hash check; real env must pass for `tempted: false`; tempted env must fail for `tempted: true`; every JSON has a README line.
    - _Requirements: 11.3, 11.4, 11.6_

- [ ] 9. CI
  - [ ] 9.1 Update `.github/workflows/ci.yml`: the `test:paw` step gets `PAW_SIZE: medium` and `PAW_TIME_SLACK: "3"` (keeping `FC_NUM_RUNS: "1000"`), the seed comes from `GITHUB_SHA`, and `actions/upload-artifact` uploads `fixtures/paw-counterexamples/` on failure.
    - _Requirements: 12.4, 12.7_
  - [ ] 9.2 Add `.github/workflows/paw-nightly.yml` (cron, `FC_NUM_RUNS=10000`, `PAW_SIZE=large`, random seed printed, artifact upload on failure, 60-minute timeout).
    - _Requirements: 12.4, 12.7_

- [ ] 10. Tempt the Paw
  - [ ] 10.1 Implement `paw/tempt.ts` (`temptedEnv`, which wraps exorcists with known flaws: the PNG one keeps `tEXt` Author, the DOCX one keeps `word/comments.xml`). Add `tempt.test.ts`: each flaw is caught within 200 runs, and the shrunk counterexample is minimal.
    - _Requirements: 15.1_
  - [ ] 10.2 Add a dependency-graph test: `apps/web/src/worker.ts`, `packages/mcp` and `packages/crew` never import `paw/tempt.ts` (static import walk with the TypeScript compiler API).
    - _Requirements: 15.3_

- [ ] 11. Paw worker
  - [ ] 11.1 Define the `PawRequest` and `PawEventSchema` zod schemas, with a round-trip property test.
    - _Requirements: 13.2_
  - [ ] 11.2 Implement `apps/web/src/paw-worker.ts`: a browser `PawEnv` (same registry as `worker.ts`, browser adapters, and a nested deadline worker for P4), `runPaw` with the 120 s total limit, a 100 ms progress throttle, and `tempted` support. Add a build check that `fast-check` and `paw/` are not in the initial chunk.
    - _Requirements: 13.1, 13.3, 13.4, 13.6, 15.2_

- [ ] 12. Paw view
  - [ ] 12.1 Implement `reduceFingers(events)` (waiting, twitching, held, curled, plus the skipped and interrupted notes) with unit tests.
    - _Requirements: 14.1, 14.2_
  - [ ] 12.2 Implement `ui/paw-hand.ts` (an SVG hand with five labelled fingers, state words, ember curl and ecto hold, a 600 ms motion with reduced-motion fallback, focus rings and 44 px targets) and `ui/paw-view.ts` (runs selector, Summon and Banish buttons, the `aria-live` progress line, the Tempt toggle and banner).
    - _Requirements: 13.5, 14.1, 14.2, 14.6, 14.7, 15.2_
  - [ ] 12.3 Implement `ui/paw-counterexample.ts` (property, guarantee, format, seed, path, shrinks, failure detail, the mono manifest table, "Hold a séance on this curse", "Copy replay command", and "Download counterexample" through a Blob URL) and "Past catches" through `import.meta.glob` of `fixtures/paw-counterexamples/*.json`.
    - _Requirements: 14.3, 14.4, 14.5_

- [ ] 13. End to end
  - [ ] 13.1 Add a Playwright test: open the Paw view, summon with 25 runs under the no-network guard, toggle Tempt, assert a finger reaches `curled`, check the counterexample card renders, and check "Hold a séance" shows at least one ghost.
    - _Requirements: 13.6, 14.2, 14.3, 14.4, 15.2_
  - [ ] 13.2 Run a tempted Summon once during development, commit the resulting counterexample with its README line as the demo's "Past catch", and check that `regressions.test.ts` covers it.
    - _Requirements: 11.6, 14.5_
