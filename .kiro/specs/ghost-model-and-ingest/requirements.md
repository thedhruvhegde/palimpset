# Requirements Document

## Introduction

This spec covers the core of `packages/core`: the public API `inspect(bytes)` and `exorcise(bytes)`, file-format sniffing from magic bytes, the extractor and exorcist registries, nested inspection (a DOCX that contains a JPEG), time budgets and cancellation, the never-throw guarantee (G5), the meaning of `Inspection.unchecked` (G6), and the zod-validated Web Worker protocol that `apps/web` uses to call core off the main thread. Every shape used here comes from `packages/core/src/types.ts`. Format-specific extraction is in the `image-ghosts` spec. Format-specific cleaning and the verification pipeline are in the `exorcism` spec.

Terms used below:
- **carries(k)** is the fixed set of ghost kinds that format `k` can contain (table in design.md, "Data Models").
- **budget** is the time limit for one top-level call, in milliseconds.
- **MiB** is 1,048,576 bytes.

## Requirements

### Requirement 1: Public inspect API and Inspection invariants

**User Story:** As a developer embedding Palimpsest (web app, MCP server, Crew bot), I want one `inspect(bytes)` function with a predictable result, so that every host shows the same ghosts for the same file.

#### Acceptance Criteria

1. The system SHALL export `inspect(bytes: Uint8Array, opts?: InspectOptions): Promise<Inspection>` and `exorcise(bytes: Uint8Array, opts?: ExorciseOptions, run?: InspectOptions & { prior?: Inspection }): Promise<Exorcism>` from `packages/core/src/index.ts`. It SHALL also export `createCore(registry: Registry)`, which returns the same two functions bound to `registry`.
2. WHEN `inspect` resolves THEN `Inspection.size` SHALL equal `bytes.byteLength`, `Inspection.kind` SHALL equal `sniff(bytes)`, and `durationMs` SHALL be a finite number ≥ 0 measured from call to resolution.
3. WHEN `bytes` is a view (`byteOffset > 0` or `byteLength < buffer.byteLength`) THEN the system SHALL read only indices `[0, bytes.byteLength)` of the view, and every reported offset SHALL be relative to index 0 of the view.
4. WHEN ghosts are returned THEN each `Ghost.id` SHALL be `${kind}:${n}`, where `n` is the 0-based position of that ghost among the ghosts of the same kind in the final order. Ids SHALL be unique within one `Inspection`, and ids set by an extractor SHALL be overwritten.
5. WHEN ghosts are returned THEN they SHALL be ordered by severity rank in `SEVERITY_ORDER` (revenant first), then by location start offset ascending (start of the outermost byte range; `pdf-region` uses page index; `zip-entry` uses path in code-point order; locations with no offset sort last), then by the order the extractor emitted them.
6. IF an extractor returns a ghost whose `confidence` is outside `[0, 1]` or not finite THEN the system SHALL clamp it to `[0, 1]` (NaN becomes 0) and add a warning with code `invalid-confidence` naming the ghost id.
7. WHEN `inspect` is called twice with byte-identical input, the same registry and no abort THEN the two results SHALL be deep-equal except for `durationMs`.

### Requirement 2: Format sniffing from magic bytes

**User Story:** As a user who drops a renamed or extensionless file, I want the format detected from its content, so that a `.txt` that is really a JPEG still has its GPS ghost found.

#### Acceptance Criteria

1. The system SHALL export `sniff(bytes: Uint8Array): FileKind` from `packages/core/src/formats/sniff.ts`. It SHALL be synchronous, never throw, and ignore any file name.
2. WHEN bytes 0–7 equal `89 50 4E 47 0D 0A 1A 0A` THEN `sniff` SHALL return `'png'`.
3. WHEN bytes 0–2 equal `FF D8 FF` THEN `sniff` SHALL return `'jpeg'`.
4. WHEN the 5-byte sequence `25 50 44 46 2D` (`%PDF-`) starts at any offset in `[0, 1019]`, so that the whole signature lies in the first 1024 bytes (ISO 32000-2 §7.5.2 readers tolerate leading junk), and rules 2.2 and 2.3 did not match, THEN `sniff` SHALL return `'pdf'`.
5. WHEN bytes 4–7 equal `66 74 79 70` (`ftyp`), the big-endian box size at bytes 0–3 is ≥ 16 and ≤ `byteLength`, and the major brand at bytes 8–11 is `heic`, `heix` or `mif1` THEN `sniff` SHALL return `'heic'`. IF the major brand is `mif1` and the compatible-brand list contains `avif` or `avis` but none of `heic`, `heix`, `hevc`, `hevx` THEN `sniff` SHALL return `'unknown'` (AVIF).
6. WHEN bytes 0–3 equal `50 4B 03 04` and the ZIP central directory (found through the End of Central Directory record `50 4B 05 06` in the last 65,557 bytes) lists both an entry named exactly `[Content_Types].xml` and an entry named exactly `word/document.xml` THEN `sniff` SHALL return `'docx'`.
7. IF a ZIP has no readable central directory THEN `sniff` SHALL fall back to walking local file headers from offset 0, reading at most 10,000 entries and at most the first 16 MiB, and SHALL apply the same two-name test.
8. IF a ZIP passes neither the central-directory test nor the local-header test (for example XLSX, PPTX, ODT, EPUB or a plain archive) THEN `sniff` SHALL return `'unknown'`.
9. IF no rule matches, including for an empty input THEN `sniff` SHALL return `'unknown'`.
10. The rules SHALL be applied in the order PNG, JPEG, PDF, HEIC, DOCX, and the first match SHALL win.
11. The system SHALL also export `sniffDetailed(bytes): { kind: FileKind; reason: string }`, where `reason` names the rule that matched (for example `png-signature`, `pdf-header@offset=37`, `zip-without-word-document`), for use in warnings.

### Requirement 3: Extractor and exorcist registries

**User Story:** As a contributor adding a format, I want to register one extractor and one exorcist in one place, so that inspect, exorcise, the Paw and `unchecked` all pick up the new format without other changes.

#### Acceptance Criteria

1. The system SHALL provide `createRegistry(entries: { extractors: Lazy<Extractor>[]; exorcists: Lazy<Exorcist>[] }): Registry`, where `Lazy<T> = T | { kind: FileKind; load: () => Promise<T> }`.
2. IF two extractors or two exorcists in one `createRegistry` call declare the same `kind` THEN `createRegistry` SHALL throw `RegistryError` with code `duplicate-kind`. This is a programming error at startup, not a reaction to input bytes.
3. IF an entry declares kind `'unknown'` THEN `createRegistry` SHALL throw `RegistryError` with code `unknown-kind-not-registrable`.
4. WHEN a lazy entry is needed for the first time THEN the system SHALL call `load()` once and cache the resulting promise. Concurrent first calls SHALL share that one promise.
5. IF a lazy `load()` rejects, or resolves to an object whose `kind` differs from the declared `kind` THEN the inspection SHALL resolve with warning `extractor-load-failed` (or `exorcist-load-failed`) and `unchecked = carries(kind)`, and the next call SHALL retry `load()`.
6. The default registry (`packages/core/src/registry/default.ts`) SHALL register PNG, JPEG and HEIC extractors eagerly, and PDF and DOCX extractors and exorcists lazily, so that `pdfjs-dist`, `pdf-lib` and `jszip` are not in the initial web bundle (250 KB gzip budget).
7. WHEN the extractor for a kind is requested THEN the registry SHALL check at load time that `extractor.detects ⊆ carries(kind)`. IF it is not THEN the system SHALL add warning `detects-exceeds-carries` and still use the extractor.

### Requirement 4: Unchecked semantics and unsupported formats

**User Story:** As a person checking whether a file is safe, I want to be told exactly which kinds of ghost were not checked, so that "0 ghosts" never secretly means "we didn't look" (G6).

#### Acceptance Criteria

1. The system SHALL compute `Inspection.unchecked` as the union of: (a) `carries(kind) \ extractor.detects`; (b) the `unchecked` list the extractor returned, intersected with `carries(kind)`; (c) every kind added by criteria 4.4–4.6, 5.2, 6.3 and 7.3. Duplicates SHALL be removed and the list SHALL follow the order of `GHOST_KINDS`.
2. IF `sniff` returns `'unknown'` THEN `inspect` SHALL resolve with `ghosts = []`, `unchecked = GHOST_KINDS` (every kind), and one warning with code `unsupported-format` whose message includes the `sniffDetailed` reason.
3. IF the sniffed kind has no registered extractor THEN `inspect` SHALL resolve with `ghosts = []`, `unchecked = carries(kind)` and warning `no-extractor`.
4. IF an inspection was aborted or exceeded its budget (Requirement 6) THEN `unchecked` SHALL equal `carries(kind)`, even when some ghosts were found. Ghosts found before the abort SHALL still be returned.
5. IF a host adapter that an extractor needs is missing (for example `decodeImage`) THEN the extractor SHALL list the affected kinds in its returned `unchecked`, and the system SHALL keep them.
6. A ghost kind MAY appear in both `ghosts` and `unchecked`. This means "some found, the check did not finish". The UI SHALL then show both the ghosts and the "could not check" line.
7. The system SHALL export `isVerifiedClean(i: Inspection): boolean`, which returns `true` only when `i.ghosts.length === 0`, `i.unchecked.length === 0`, `i.kind !== 'unknown'` and no warning has a code in `{ 'aborted', 'budget-exceeded', 'extractor-crashed', 'file-too-large', 'max-depth' }`.

### Requirement 5: Never-throw guarantee

**User Story:** As a user dropping a damaged or hostile file, I want the app to keep working and show what it could read, so that one bad file never crashes the séance (G5).

#### Acceptance Criteria

1. The promise returned by `inspect` SHALL never reject, and `inspect` SHALL never throw synchronously, for any input. This includes non-`Uint8Array` values passed at runtime from untyped JavaScript, which SHALL resolve as `kind: 'unknown'` with `size: 0` and warning `invalid-input`.
2. IF an extractor throws synchronously, rejects, or resolves to a value that fails `ExtractResultSchema` THEN `inspect` SHALL resolve with that extractor's valid ghosts (none if the result was invalid), a warning `extractor-crashed` or `extractor-invalid-result` whose message contains the error name and at most 200 characters of its message (and no file bytes), and `unchecked ⊇ extractor.detects`.
3. IF a nested inspection fails in any of these ways THEN the failure SHALL be contained to that nested call (Requirement 7) and SHALL NOT discard the parent's ghosts.
4. The promise returned by `exorcise` SHALL never reject for any input. On failure it SHALL resolve with `output` of length 0, `banished = []`, a warning `exorcism-failed`, and `verification` equal to the inspection of the empty output.
5. Every warning `message` SHALL be ≤ 300 characters and SHALL NOT contain more than 64 bytes copied from the input file. This stops error messages from leaking content into logs.

### Requirement 6: Time budgets and cancellation

**User Story:** As a user who drops a 40 MB scan, I want inspection to finish or stop within a known time, so that the app never hangs (G5).

#### Acceptance Criteria

1. The system SHALL use `budgetMs = clamp(ceil(2000 × size / 1,048,576), 1000, 120000)` (2 s per MiB, at least 1 s, at most 120 s) unless `opts.budgetMs` is an integer in `[1, 600000]`. IF `opts.budgetMs` is present and invalid THEN the system SHALL ignore it and add warning `invalid-option`.
2. WHEN a top-level call starts THEN the system SHALL create one internal `AbortSignal` that aborts when either `opts.signal` aborts or `budgetMs` elapses. It SHALL pass this signal as `ctx.signal` to the extractor and to every nested inspection.
3. WHEN the internal signal aborts THEN the system SHALL wait at most 250 ms (grace period) for the extractor to resolve with partial results. It SHALL then resolve with whatever arrived (or `ghosts = []`), a warning `budget-exceeded` (time) or `aborted` (caller signal), and `unchecked = carries(kind)`.
4. IF `opts.signal` is already aborted when `inspect` is called THEN the system SHALL NOT call any extractor and SHALL resolve within 50 ms with `ghosts = []`, warning `aborted` and `unchecked = carries(kind)`.
5. Every extractor and exorcist SHALL check `ctx.signal?.aborted` at least once per 64 KiB of input processed and at least once per loop iteration that can run more than 10,000 times. When it sees the abort it SHALL return its partial result rather than throw.
6. WHEN an `exorcise` call is aborted THEN it SHALL resolve per criterion 5.4 with warning `aborted` instead of `exorcism-failed`.

### Requirement 7: Nested inspection

**User Story:** As someone sharing a Word document, I want the photos inside it inspected too, so that a GPS tag in an embedded JPEG is not missed.

#### Acceptance Criteria

1. The system SHALL set `ctx.depth = 0` for a top-level call. `ctx.inspectNested(bytes, ctx)` SHALL inspect `bytes` at depth `ctx.depth + 1`, using the same registry, signal and adapters, and SHALL return an `Inspection`.
2. The maximum inspected depth SHALL be 3. A top-level DOCX at depth 0 can therefore reach a nested image at depth 1 and, through nesting in that image, depths 2 and 3.
3. IF `inspectNested` is called with `ctx.depth ≥ 3` (the child would be at depth 4) THEN it SHALL NOT call any extractor. It SHALL resolve with `kind = sniff(bytes)`, `ghosts = []`, `unchecked = carries(kind)` and warning `max-depth`.
4. The system SHALL export `nestGhosts(inner: Inspection, container: GhostLocation): Ghost[]`. For each inner ghost `g` it SHALL return a ghost with `kind = 'embedded-media-ghost'`, `severity = g.severity`, `confidence = g.confidence`, `location = { type: 'nested', container, inner: g.location, innerKind: inner.kind }`, `title = "Inside <innerKind>: " + g.title`, and `evidence = { ...g.evidence, raw: { innerGhost: g } }`.
5. The system (not the extractor) SHALL record every `Inspection` that `inspectNested` returns during a call. IF any recorded nested `Inspection` has a non-empty `unchecked` or any warning THEN the system SHALL add `'embedded-media-ghost'` to the parent's `unchecked` and SHALL copy each nested warning into the parent's warnings with its code prefixed `nested:`. Copied warnings SHALL keep their message, and their `offset` SHALL be dropped, because it is relative to the nested bytes.
6. Time spent in nested inspections SHALL count toward the top-level budget. Nested calls SHALL NOT start new budgets.

### Requirement 8: Exorcise entry point and dispatch

**User Story:** As a developer, I want `exorcise(bytes)` to pick the right exorcist by content, so that callers never need to know the format.

#### Acceptance Criteria

1. WHEN `exorcise` is called THEN the system SHALL sniff the input and dispatch to the exorcist registered for that kind, passing a context with `depth = 0`, the combined signal from Requirement 6, and the caller's adapters.
2. IF the kind is `'unknown'` or has no exorcist THEN `exorcise` SHALL resolve with `output` of length 0, `banished = []`, warning `no-exorcist` and `verification = inspect(output)`. It SHALL NOT return the input bytes as a "clean" file.
3. The verification, banished counting, second pass and G2 copy rules SHALL follow the `exorcism` spec, Requirements 1–3.

### Requirement 9: Web Worker message protocol

**User Story:** As a user, I want the page to stay responsive while a large PDF is parsed, so that scraping and animations never stutter.

#### Acceptance Criteria

1. `apps/web` SHALL run every `inspect` and `exorcise` call in a dedicated module Web Worker (`apps/web/src/worker.ts`). The main thread SHALL NOT import any extractor or exorcist module.
2. Every message in either direction SHALL carry `v: 1` and SHALL be validated with the zod schemas in `apps/web/src/worker-protocol.ts` before it is used.
3. The request types SHALL be exactly `inspect` (`id`, `bytes`, optional `budgetMs`), `exorcise` (`id`, `bytes`, `options: ExorciseOptions`, optional `priorId`) and `cancel` (`id`). The response types SHALL be exactly `ready`, `progress` (`id`, `stage`), `inspection` (`id`, `inspection`), `exorcism` (`id`, `exorcism`) and `failed` (`id`, `code`, `message`).
4. `id` SHALL be a UUID string produced by `crypto.randomUUID()` on the main thread. Every request SHALL get exactly one terminal response (`inspection`, `exorcism` or `failed`) with the same `id`.
5. IF the worker receives a message that fails validation THEN it SHALL reply `failed` with code `invalid-message` (and `id` set to the message's `id` if that field is a string, otherwise `""`) and SHALL continue serving later messages.
6. IF the main thread receives a response that fails validation THEN it SHALL treat every pending request as failed, terminate the worker and create a new one.
7. The main thread SHALL post a fresh `ArrayBuffer` for each request (from `File.arrayBuffer()`) in the transfer list. It SHALL keep the original `File` object, so the user's original is never detached or changed (G2). The worker SHALL transfer `exorcism.output.buffer` and every `evidence.preview.bytes.buffer` back.
8. WHEN a `cancel` arrives for the request that is running THEN the worker SHALL abort its signal, and that request SHALL end with a response that carries warning `aborted` (an `inspection` or `exorcism`). WHEN a `cancel` arrives for a queued request THEN the worker SHALL drop it and reply `failed` with code `cancelled`.
9. The worker SHALL process requests one at a time in FIFO order.
10. IF no terminal response arrives within `budgetMs + 5000` ms of a request reaching the front of the queue THEN the main thread SHALL terminate and recreate the worker. It SHALL then show that file as "could not check" using a placeholder `Inspection` with `kind = sniff(bytes)` (computed on the main thread), `ghosts = []`, `unchecked = carries(kind)` and warning `worker-timeout`.
11. WHEN an `exorcise` request carries a `priorId` THEN the worker SHALL reuse the cached `Inspection` from that `inspect` request as `run.prior`. The cache SHALL hold the latest 4 inspections.

### Requirement 10: Input limits

**User Story:** As a user on a phone, I want oversized files refused politely, so that the tab doesn't run out of memory.

#### Acceptance Criteria

1. IF `bytes.byteLength > 209,715,200` (200 MiB) THEN `inspect` SHALL NOT call any extractor and SHALL resolve with `kind = sniff(bytes)`, `ghosts = []`, `unchecked = carries(kind)` and warning `file-too-large`.
2. IF the input to `exorcise` is over 200 MiB THEN `exorcise` SHALL resolve per criterion 5.4 with warning `file-too-large`.
3. Any decompression an extractor does (zlib, deflate, ZIP entries) SHALL stop at 64 MiB of output per stream and 256 MiB per top-level call. When either cap is hit the extractor SHALL add warning `decompression-limit` and add the affected kinds to `unchecked`.

### Requirement 11: Boundary schemas mirror types.ts

**User Story:** As a maintainer, I want runtime schemas that cannot drift from `types.ts`, so that the worker, MCP server and Crew bot reject malformed results.

#### Acceptance Criteria

1. The system SHALL export zod schemas `GhostKindSchema`, `SeveritySchema`, `GhostLocationSchema` (recursive, covering the `nested` variant), `GhostSchema`, `WarningSchema`, `InspectionSchema`, `ExtractResultSchema`, `ExorciseOptionsSchema` and `ExorcismSchema` from `packages/core/src/schema.ts`.
2. A type-level test SHALL fail to compile unless `z.infer<typeof InspectionSchema>` and `Inspection` are mutually assignable, and likewise for `Ghost`, `ExorciseOptions` and `Exorcism`.
3. `GhostKindSchema` SHALL be built from `GHOST_KINDS`, and a compile-time exhaustiveness check SHALL fail if a `GhostKind` member is missing from `GHOST_KINDS`.
4. `InspectionSchema.safeParse(r).success` SHALL be `true` for every `r` that `inspect` returns.

### Requirement 12: No network in core

**User Story:** As a person handling sensitive files, I want proof that core cannot send my bytes anywhere, so that I can trust "nothing leaves the page" (G1).

#### Acceptance Criteria

1. The build SHALL fail if any file under `packages/core/src` (tests excluded) mentions the identifiers `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` or `importScripts`, or contains a dynamic `import()` whose specifier is not a relative path or a bare package name listed in `packages/core/package.json`. This is enforced by an ESLint `no-restricted-globals` / `no-restricted-syntax` rule.
2. The production `apps/web/index.html` SHALL set a Content-Security-Policy with `connect-src 'none'`, `default-src 'self'` and `worker-src 'self'`. The only extra source SHALL be `img-src https://tile.openstreetmap.org` for the opt-in map defined in the `image-ghosts` spec.
