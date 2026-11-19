# Implementation Plan

Prerequisites: from the ghost-model-and-ingest spec, `formats/sniff.ts` (OOXML → `docx`), `schema.ts`, the registry, the orchestrator's `inspectNested` and `nested.ts` (`nestGhosts`); `extractors/shared/pii-patterns.ts` (pdf-ghosts 1.2); the-paw tasks 1–2 and 4 (byte helpers, image writers, `paw/gen/zip-writer.ts`, `paw/gen/docx-writer.ts`), plus task 5 (`build`, arbitraries) before any property-test subtask. The image-ghosts PNG and JPEG extractors are needed for task 11.2. Every task leaves `npm run typecheck`, `npm test` and `npm run test:paw` green.

- [ ] 1. Types and skeleton
  - [ ] 1.1 Apply the proposed `types.ts` change: add `'hidden-text'` and `'alt-text'` to `GhostKind`, and to `GHOST_KINDS` and `carries('docx')` in `ghost-kinds.ts`. Extend `types.test.ts`. Let the `types-changed` hook flag the exorcism, vellum-ui, mcp-and-power and the-paw specs.
    - _Requirements: 1.1, 9.2, 10.2, 11.2_
  - [ ] 1.2 Create `limits.ts`, `namespaces.ts` and `index.ts` with `extractor` (`kind`, `detects`) that returns `docx-not-a-package` for every input. Register it lazily (`{ kind: 'docx', load: () => import('./extractors/docx') }`) in the core registry. Test that `extract` on garbage resolves, with every kind in `unchecked`.
    - _Requirements: 1.1, 1.3, 1.5, 2.9_

- [ ] 2. Streaming XML scanner
  - [ ] 2.1 Write `xml-scan.test.ts` first: elements, self-closing tags, attributes with both quote styles, the five entities, numeric references (decimal, hex, astral), CDATA, comments, PIs, DOCTYPE with an internal subset, unknown entities, mismatched and unclosed tags, positional paths, namespace scoping and redefinition.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8_
  - [ ] 2.2 Implement `scanXml` (generator, scope stack, recovery, limits) and `decodePart` (UTF-8, UTF-16LE and UTF-16BE BOMs) until 2.1 passes.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_
  - [ ] 2.3 Add `xmlTreeArb`, and xml-scan properties 1 (totality), 2 (round-trip), 3 (prefix independence) and 4 (no entity expansion).
    - _Requirements: 3.1, 3.2, 3.3, 3.7, 3.9_

- [ ] 3. ZIP guard
  - [ ] 3.1 Write tests first, then implement `readCentralDirectory`: EOCD search in the last 65,557 bytes, the Zip64 locator and record, central records, name decoding, and local-header lookup to compute `dataRange`.
    - _Requirements: 2.1_
  - [ ] 3.2 Implement `applyLimits`: entry count, total and per-entry size, ratio, overlap detection (sort by `dataRange.start`), case-insensitive duplicates, encryption flag and method. Unit tests use writer-built hostile packages.
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.7, 2.8_
  - [ ] 3.3 Add zip-guard properties 5 (the guard agrees with the writer) and 6 (overlapping entries refused before jszip).
    - _Requirements: 2.1, 2.5_

- [ ] 4. Package access
  - [ ] 4.1 Implement `package.ts`: the lazy `import('jszip')`, `loadAsync` with `checkCRC32: false`, the guarded `readPart` with a byte counter and `pause()`, the post-inflate CRC check, and the signal check between entries. Test that the input bytes are unchanged and that jszip is not in the initial web chunk.
    - _Requirements: 1.2, 1.4, 2.6, 2.10_
  - [ ] 4.2 Implement `readDuplicateCopies` with `DecompressionStream('deflate-raw')` and the `docx-duplicate-unchecked` fallback.
    - _Requirements: 2.7_
  - [ ] 4.3 Implement `rels.ts` and part discovery: the main part from `_rels/.rels` with the guessed fallback, target resolution, External rels, the docProps fallbacks, and media and embeddings candidates.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ] 4.4 Add zip-guard property 7 (inflate stays within the declared size), using the writer's `lieAboutSize` option.
    - _Requirements: 2.6_

- [ ] 5. Visitor framework and styles
  - [ ] 5.1 Implement the `Visitor` driver in `index.ts`: part order, one scan per part feeding every visitor, the signal check every 8,192 events, part-size skipping, per-part `unchecked` mapping, and the 1,000-ghost cap and string cutting.
    - _Requirements: 2.10, 12.1, 12.2, 12.3_
  - [ ] 5.2 Implement `styles.ts` (`StyleTable` with a cycle-safe `basedOn` chain of up to 10 steps) with unit tests.
    - _Requirements: 9.1_

- [ ] 6. Tracked changes
  - [ ] 6.1 Write visitor tests first (`w:ins`, `w:del` with `w:delText`, moves, `rPrChange`, nesting, more than 100 changes), then implement `visitors/tracked-changes.ts` with fields, summary, severity, xpath and grouping.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [ ] 6.2 Add docx property 8 (tracked changes).
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 7. Comments
  - [ ] 7.1 Implement `visitors/comments.ts`: anchors from story parts, comments from `comments.xml`, `done` flags from `commentsExtended.xml`, and orphans. Unit tests come first.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [ ] 7.2 Add docx property 9 (comments).
    - _Requirements: 6.1, 6.2_

- [ ] 8. Revision ids
  - [ ] 8.1 Implement `visitors/rsid.ts` (settings `w:rsids` plus `rsid*` attributes plus the paraId/textId count) with the explanation text and `RsidRaw`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [ ] 8.2 Add docx property 10 (rsids).
    - _Requirements: 7.1, 7.2, 7.4_

- [ ] 9. Properties and author identity
  - [ ] 9.1 Implement `visitors/properties.ts` for core, app and custom parts and `attachedTemplate`, with the path, company and wisp severity rules, `author-identity` per distinct name with roles, and the derived `software-trail` and `capture-time` ghosts.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6_
  - [ ] 9.2 Add `people.xml` (revenant on an email or SID userId) and `customXml/item*.xml` leaf scanning.
    - _Requirements: 8.5, 8.7_
  - [ ] 9.3 Add docx property 11 (properties and authors).
    - _Requirements: 8.2, 8.4, 8.5_

- [ ] 10. Hidden text and alt text
  - [ ] 10.1 Implement `visitors/hidden-text.ts` (direct, rStyle and pStyle vanish; `w:val` false values; span merging; PII severity), with unit tests first.
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ] 10.2 Implement `visitors/alt-text.ts` (docPr, cNvPr and VML; the default-name filter; `r:embed` resolution).
    - _Requirements: 10.1, 10.2, 10.3_
  - [ ] 10.3 Add docx properties 12 (hidden text) and 13 (alt text).
    - _Requirements: 9.1, 9.2, 10.2_

- [ ] 11. Embedded media
  - [ ] 11.1 Implement `media.ts`: list candidates, apply the 64 MB and 200-entry limits, call `ctx.inspectNested(bytes, ctx)` with the extractor's own `ctx`, wrap with `nestGhosts(inner, { type: 'zip-entry', path })`, and report only the entries the extractor skipped itself. Unit test with a stub `inspectNested` that checks the `ctx` is passed through unchanged and no warnings are copied.
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6_
  - [ ] 11.2 Add docx properties 14 (nested equals standalone) and 15 (depth limit, including nested-in-nested locations), using the real registry.
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

- [ ] 12. Hardening and integration
  - [ ] 12.1 Add docx property 16 (totality, immutability, budget) on arbitrary bytes, ZIP-magic-prefixed garbage and mutated writer output.
    - _Requirements: 1.3, 1.4, 2.10_
  - [ ] 12.2 Add the hostile fixtures (nested ratio bomb, overlapping bomb, duplicate main part, billion-laughs DOCTYPE) and the slow-marked 50 MB budget test.
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 3.3, 3.9_
  - [ ] 12.3 Add the Haunted Gallery DOCX (`tracked-letter.docx` with Ada Quill's deletions and Corwin Vale's comments, rsids, a template path and an embedded GPS JPEG) to `scripts/make-fixtures.ts`, plus a ghost-list snapshot test, and include it in the Playwright no-network run.
    - _Requirements: 5.1, 6.1, 7.2, 8.2, 11.2_
