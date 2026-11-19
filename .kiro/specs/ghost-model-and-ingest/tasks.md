# Implementation Plan

> Items marked [x] were implemented with Claude Code before the first Kiro session (see docs/PROVENANCE.md). Everything else is built in Kiro.

- [ ] 1. Land the type additions and the canonical kind list
  - [x] 1.1 Add `GHOST_KINDS` and `InspectOptions` to `packages/core/src/types.ts`, as given in design.md "Proposed change to types.ts". Add the compile-time exhaustiveness check in `ghost-kinds.ts`.
  - [ ] 1.2 Add the `CARRIES` table and `carries(kind)` to `ghost-kinds.ts`. Write a unit test asserting `CARRIES.unknown` deep-equals `GHOST_KINDS` and that every other row is a subset of `GHOST_KINDS`, in canonical order.
  - _Requirements: 4.1, 4.2, 11.3_

- [ ] 2. Byte utilities
  - [x] 2.1 Write tests first for `readU16BE/LE`, `readU32BE/LE` (out of range returns `undefined`, never throws) and `indexOf(bytes, needle, from, to)`, including on `subarray` views with a non-zero `byteOffset`.
  - [x] 2.2 Implement `packages/core/src/util/bytes.ts`.
  - _Requirements: 1.3, 5.1_

- [ ] 3. Sniffing for PNG, JPEG, PDF and HEIC
  - [ ] 3.1 Write example tests for each signature, plus the AVIF exclusion and the `%PDF-` offsets 0, 37, 1019 (match) and 1020 (no match).
  - [x] 3.2 Implement `sniff` and `sniffDetailed` for these four kinds, applying the rules in order PNG, JPEG, PDF, HEIC.
  - [ ] 3.3 Add Properties 1, 2, 3, 4 and 6 in `formats/sniff.prop.test.ts`.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.9, 2.10, 2.11_

- [ ] 4. ZIP name scan and DOCX sniffing
  - [ ] 4.1 Add a minimal test-only ZIP writer in `packages/core/test-support/zip-writer.ts`. It writes stored entries, optional data descriptors and optional ZIP64 EOCD, so tests don't depend on jszip.
  - [ ] 4.2 Write tests for DOCX, XLSX, EPUB, a corrupt EOCD that falls back to local headers, ZIP64, and the 10,000-entry cap.
  - [x] 4.3 Implement `formats/zip-names.ts` (central directory first, then local headers) and the DOCX rule in `sniff`.
  - [ ] 4.4 Add Property 5.
  - _Requirements: 2.6, 2.7, 2.8_

- [ ] 5. Zod schemas mirroring types.ts
  - [ ] 5.1 Implement `schema.ts`, including the recursive `GhostLocationSchema` built with `z.lazy` and `GhostKindSchema = z.enum(GHOST_KINDS)`.
  - [ ] 5.2 Add `schema.typetest.ts` (mutual assignability) and wire `tsc --noEmit` on it into `npm run typecheck`.
  - _Requirements: 11.1, 11.2, 11.3_

- [ ] 6. Registry
  - [ ] 6.1 Write tests for duplicate kinds, registering `unknown`, lazy load called once under concurrency, a rejected load followed by a successful retry, a kind mismatch after load, and `detects-exceeds-carries`.
  - [x] 6.2 Implement `registry/registry.ts` (`createRegistry`, `Lazy<T>`, `RegistryError`).
  - [x] 6.3 Add `registry/default.ts` with an empty extractor and exorcist list. Later specs register into it.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_

- [ ] 7. Budget and signal helpers
  - [ ] 7.1 Write tests for the `computeBudget` boundaries, the invalid override warning, `linkSignals` reasons (`budget` vs `caller`) and `dispose()` clearing timers.
  - [x] 7.2 Implement `orchestrator/budget.ts` with `computeBudget`, `linkSignals` (without `AbortSignal.any`) and `withGrace`.
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 8. Normalization and unchecked computation
  - [x] 8.1 Implement `finalize.ts` (`normalizeGhosts`: clamping, `locationSortKey`, stable sort, id assignment) and `unchecked.ts` (`computeUnchecked`).
  - [ ] 8.2 Add Properties 9, 10 and 11 using generated ghost lists.
  - _Requirements: 1.4, 1.5, 1.6, 4.1, 4.6_

- [ ] 9. Orchestrated inspect
  - [ ] 9.1 Add test-support stubs: `throwing`, `hanging`, `emitting`, `recursing`, `cooperative`.
  - [x] 9.2 Implement `orchestrator/inspect.ts` (`inspectWith`) with the short-circuit order from the design: invalid input, pre-aborted, too large, unknown, no extractor, load failure. Then run the extractor through `withGrace`, validate with `ExtractResultSchema`, and normalize.
  - [ ] 9.3 Export `inspect`, `createCore` and `isVerifiedClean` from `index.ts`.
  - [ ] 9.4 Add Properties 7, 8, 12, 13, 14, 15, 18 and 21.
  - _Requirements: 1.1, 1.2, 1.7, 4.2, 4.3, 4.4, 4.5, 4.7, 5.1, 5.2, 5.5, 6.3, 6.4, 6.5, 10.1, 11.4_

- [ ] 10. Nested inspection
  - [x] 10.1 Implement `ctx.inspectNested` (depth + 1, refusal at depth 4, shared signal), recording of nested inspections, warning copy-up with the `nested:` prefix, and `embedded-media-ghost` added to `unchecked`.
  - [x] 10.2 Implement `nested.ts` (`nestGhosts`, `isNestedGhostRaw`).
  - [ ] 10.3 Add Properties 16 and 17.
  - _Requirements: 5.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 11. Exorcise entry point (dispatch only)
  - [ ] 11.1 Implement `orchestrator/exorcise.ts` with dispatch, `no-exorcist`, `file-too-large`, the abort path and the never-reject wrapper (empty output plus `verification = inspect(empty)`). For a found exorcist, return its output with `verification = inspect(output)`. The exorcism spec, Requirements 1–3, replaces this with the full pipeline.
  - [ ] 11.2 Add tests for the `no-exorcist`, throwing-exorcist and aborted cases, and a property that `exorcise` never rejects for arbitrary bytes.
  - _Requirements: 1.1, 5.4, 6.6, 8.1, 8.2, 8.3, 10.2_

- [ ] 12. Decompression caps helper
  - [ ] 12.1 Implement `util/limits.ts`: a per-call `DecompressionMeter` stored in an internal context, with `take(n)` that returns `false` once the 64 MiB per-stream or 256 MiB per-call cap is crossed. Unit-test both caps.
  - _Requirements: 10.3_

- [ ] 13. No-network lint for core
  - [ ] 13.1 Add ESLint `no-restricted-globals` and `no-restricted-syntax` rules for `packages/core/src/**` (excluding tests), plus a lint test fixture file that must fail.
  - _Requirements: 12.1_

- [ ] 14. Worker protocol schemas
  - [ ] 14.1 Implement `apps/web/src/worker-protocol.ts` using the core schemas.
  - [ ] 14.2 Add Property 19 (round trip through `structuredClone`).
  - _Requirements: 9.2, 9.3, 9.4_

- [ ] 15. Worker handler
  - [ ] 15.1 Write tests for the pure `handle(msg, deps)`: FIFO order, cancel of the running request (ends with `aborted`), cancel of a queued request (`failed`/`cancelled`), invalid message, and reuse of the prior cache (4 entries, LRU).
  - [ ] 15.2 Implement `apps/web/src/worker.ts`, transferring `output.buffer` and preview buffers back.
  - [ ] 15.3 Add Property 20.
  - _Requirements: 9.1, 9.5, 9.7, 9.8, 9.9, 9.11_

- [ ] 16. Main-thread worker client
  - [ ] 16.1 Implement `apps/web/src/worker-client.ts`: a fresh `File.arrayBuffer()` per request, transfer, response validation, terminate and respawn on an invalid response, and the watchdog (`budgetMs + 5000`) with the placeholder `worker-timeout` inspection.
  - [ ] 16.2 Add unit tests with a fake `Worker`, and a Playwright long-task test (under 100 ms on the main thread) on the generated 30 MiB PDF fixture.
  - _Requirements: 9.1, 9.6, 9.7, 9.10_

- [ ] 17. CSP for the web app
  - [ ] 17.1 Add the production CSP meta tag to `apps/web/index.html`. Extend the Playwright no-network test to assert that the CSP header or meta is present and that `connect-src` is `'none'`.
  - _Requirements: 12.2_

- [ ] 18. Default registry wiring for the bundle budget
  - [ ] 18.1 Register the PDF and DOCX entries as `Lazy` loaders (stubs until their specs land). Add a build check that the initial web chunk contains no `pdfjs-dist`, `pdf-lib` or `jszip` module ids and stays ≤ 250 KB gzip.
  - _Requirements: 3.6_
