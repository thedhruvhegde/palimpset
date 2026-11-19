# Requirements Document

## Introduction

The Paw is Palimpsest's property-based adversary, built on `fast-check` (4.10.2). It generates **curses**: valid PNG, JPEG, PDF and DOCX files built from scratch in pure TypeScript, each with a **manifest** of the ghosts planted in it. It then tries to break the guarantees in the threat model. It runs in three places from one codebase: in vitest (`npm run test:paw`), in CI (more runs, with seeds reported) and in the app ("Summon the Paw"), in a Web Worker, where each failing guarantee curls one of the Paw's five fingers and the shrunk counterexample is shown on the vellum.

Properties and the guarantees they test:

| Id | Property | Guarantee | Finger |
|---|---|---|---|
| P1 | Completeness: every planted ghost is found by `inspect` | G4 | Index |
| P6 | Nested propagation: a ghost in an image inside a DOCX is reported with a `nested` location | G4 | Index |
| P2 | Exorcism soundness: `inspect(exorcise(f))` has no ghost of a kind in `removes` | G3 | Middle |
| P3 | Idempotence: exorcising twice equals exorcising once | (exorcist quality) | Ring |
| P4 | Robustness: `inspect` never throws or hangs on arbitrary or mutated bytes | G5 | Little |
| P5 | Original immutability: inputs are never mutated, detached or aliased | G2 | Thumb |

The Paw has five fingers and there are six properties. P1 and P6 both test G4 (detection completeness), so they share the index finger, and either failing curls it.

Terms:
- **Recipe:** a plain, JSON-serialisable description of a curse (format, content, ghosts to plant, mutations). Arbitraries generate recipes. A pure builder turns a recipe into bytes and a manifest.
- **Planted ghost:** an entry in the manifest saying which ghost kind must be found, roughly where, and which synthetic tokens its evidence must contain.
- **Case:** one (property, format) pair, run for a set number of runs from a set seed.
- **Curled finger:** a property that found a counterexample. **Held finger:** a property that passed every run.

## Requirements

### Requirement 1: Curse builders

**User Story:** As a Paw author, I want pure builders that make valid files of each format from a recipe, so that every generated case exercises the real parsers and not their error paths.

#### Acceptance Criteria

1. The system SHALL provide `build(recipe): Promise<Curse>`, which returns `{ kind, bytes, manifest }` and uses no randomness, clock, network or DOM API. The same recipe SHALL always give byte-identical output.
2. The PNG builder SHALL write the signature, IHDR, optional ancillary chunks (`tEXt`, `zTXt`, `iTXt`, `eXIf`, `iCCP`, `tIME`), one or more IDAT chunks holding a zlib stream of deflate *stored* blocks (or fixed-Huffman literal blocks) with a correct Adler-32, IEND, and correct CRC-32 on every chunk.
3. The PNG builder SHALL support an aCropalypse-style tail: it builds a taller original image, writes the cropped image over its start, and keeps the original's remaining bytes after the new IEND.
4. The JPEG builder SHALL write a baseline (SOF0) JPEG with standard Annex K Huffman tables, using a DC-only encoder for 1 or 3 components at any size from 1×1 to 512×512, with injectable APP1 EXIF, APP1 XMP, APP2 ICC and COM segments, and optional bytes after EOI.
5. The EXIF writer SHALL produce a TIFF structure in either byte order, with IFD0 (Make, Model, Software, Artist, Copyright, DateTime), an Exif IFD (DateTimeOriginal, BodySerialNumber, LensSerialNumber), a GPS IFD (latitude and longitude as rationals with refs) and an optional IFD1 thumbnail made by the JPEG builder.
6. The PDF builder SHALL write PDF 1.4–1.7 files with a classic xref table or an uncompressed xref stream. It SHALL support Helvetica (WinAnsi) text lines, filled rectangles drawn before or after text with a set color and alpha, an Info dictionary, an XMP metadata stream, annotations (`Text`, `FreeText`, `Square`, `Redact`, `FileAttachment`) with flags, `/T` and `/Contents`, `EmbeddedFiles` attachments, a linearized-style first-page section, a `locked` or `owner-only` `/Encrypt`, and any number of incremental updates with correct `/Prev` chains.
7. The ZIP writer SHALL write store and fixed-Huffman deflate entries with a fixed DOS timestamp (1980-01-01 00:00), optional Zip64 records, any entry order, and hostile options (duplicate names, overlapping data ranges, understated uncompressed size).
8. The DOCX builder SHALL write `[Content_Types].xml`, relationships, the main part, and optionally comments, commentsExtended, settings (with `w:rsids`), styles, people, docProps core/app/custom, customXml, `word/media/*` images built by the PNG/JPEG builders, and `word/embeddings/*.docx` nested DOCX up to 3 levels. It SHALL use standard or renamed namespace prefixes.
9. Every builder's output SHALL be accepted by an independent reader in the unit tests: `pngjs` for PNG, `jpeg-js` for JPEG, pdf.js for PDF and jszip for DOCX.
10. Builders SHALL use only synthetic identities, places and text from `paw/synthetic.ts` (for example "Ada Quill", "Corwin Vale", public-landmark coordinates), each with a unique random suffix, so that tokens never match by accident.

### Requirement 2: Manifests and matching

**User Story:** As a Paw author, I want a precise rule for when a planted ghost counts as found, so that P1 and P6 failures are real.

#### Acceptance Criteria

1. Each `PlantedGhost` SHALL give the expected `kind`, a location matcher, a list of evidence tokens, a minimum confidence (default 0.6) and, for nested ghosts, the container path, inner `FileKind` and inner planted ghost.
2. The system SHALL treat a planted ghost as found by a reported ghost only WHEN the kinds are equal, the location matcher accepts the reported location, every token appears (case-insensitively, after Unicode NFC and whitespace collapsing) in `evidence.summary` or a value in `evidence.fields`, and `confidence ≥ minConfidence`.
3. The location matcher SHALL accept: `bytes` (a `byte-range` or `chunk` location whose `[start, end)` overlaps the planted range); `chunk-name` (a `chunk` with that name); `pdf-region` (the same 1-based page and IoU ≥ 0.3, or one rect containing the other); `pdf-revision` (the same index); `zip-entry` (the same path); `nested` (a `nested` location with the same container path and `innerKind`, whose `inner` matches the inner matcher); and `any`.
4. Numeric tokens (GPS) SHALL match any decimal number in the evidence within the given tolerance (default 1e-4 degrees).
5. The system SHALL decide completeness by an injective matching (Kuhn's augmenting-path algorithm), so that two planted ghosts of the same kind need two distinct reported ghosts.
6. A manifest MAY also list `decoys` (things that must not count as planted, such as a rectangle drawn before the text). P1 SHALL NOT assert on decoys. They exist for the format specs' precision properties.

### Requirement 3: Generator coverage contract

**User Story:** As a maintainer, I want the Paw to notice when an extractor claims a ghost kind the Paw cannot plant, so that G4 coverage never quietly shrinks.

#### Acceptance Criteria

1. The system SHALL keep a `PLANTERS` table mapping `(FileKind, GhostKind)` to the recipe options that plant that kind.
2. The system SHALL keep a `NOT_PLANTABLE` table mapping `(FileKind, GhostKind)` to a written reason (for example `text-in-pixels: needs OCR, best effort`, or `heic: no HEIC writer in v1`).
3. WHEN the coverage test runs THEN the system SHALL fail for every registered extractor kind in `detects` that is in neither table, and for every planter whose kind is not in that extractor's `detects`.
4. The Paw report SHALL list every `NOT_PLANTABLE` entry under "Not summoned", so that the gap is visible (G6).

### Requirement 4: P1 Completeness

**User Story:** As a user relying on the ledger, I want proof that planted ghosts are always found, so that "no ghosts" means something (G4).

#### Acceptance Criteria

1. For each format with a registered extractor and at least one planter, the system SHALL generate recipes that plant at least one ghost, build them, run `inspect`, and assert every planted ghost is found (Requirement 2).
2. The property SHALL also fail IF any planted ghost's kind appears in `inspection.unchecked`, or `inspection.kind` is not the recipe's format.
3. The failure detail SHALL list each unmatched planted ghost, together with the closest reported ghosts of the same kind.

### Requirement 5: P2 Exorcism soundness

**User Story:** As a user who clicks Exorcise, I want proof that nothing the exorcist claims to remove survives, so that the clean copy is clean (G3).

#### Acceptance Criteria

1. For each format with a registered exorcist, the system SHALL generate a recipe and a subset `K` of `exorcist.removes` (the full set in at least half the runs). It SHALL run `exorcise(bytes, { kinds: K })` and then `inspect(output)`.
2. The property SHALL assert that no ghost in the fresh inspection has a kind in `K`. This means that WHEN `embedded-media-ghost ∈ K`, no nested ghost of any inner kind survives.
3. The property SHALL assert that `inspection.unchecked ∩ K` is empty, because an output that cannot be checked is not proven clean.
4. The property SHALL assert that `exorcism.verification` is ghost-equivalent (Requirement 6.3) to the fresh inspection.
5. The property SHALL assert that `sniff(output)` equals the input format.

### Requirement 6: P3 Idempotence

**User Story:** As a maintainer, I want exorcising an already-clean file to change nothing, so that exorcists are deterministic and stable.

#### Acceptance Criteria

1. The system SHALL compute `o1 = exorcise(f).output` and `o2 = exorcise(o1).output` with the same options.
2. WHERE the format's idempotence mode is `bytes` (default: png, pdf, docx), the property SHALL assert that `o2` is byte-identical to `o1`.
3. WHERE the mode is `ghost-equivalent` (default: jpeg, heic, and any format exorcised with `reencode: true` through a lossy encoder), the property SHALL assert `canon(inspect(o1)) = canon(inspect(o2))`. Here `canon` maps an inspection to: its `kind`; the sorted multiset of `(ghost.kind, severity, canonLocation, normalized summary, sorted field entries)`; the sorted set of warning codes; and the sorted set of `unchecked`. `canonLocation` drops byte offsets but keeps chunk names, PDF page numbers, rects rounded to whole units, revision indices, zip paths and xpaths, and nested structure. It SHALL also assert that the decoded pixel dimensions of `o1` and `o2` are equal.
4. In both modes, the property SHALL assert that the second exorcism's `banished` counts are all zero.
5. Changing a format's mode from `bytes` to `ghost-equivalent` SHALL require an entry in `IDEMPOTENCE_MODES` with a written justification.

### Requirement 7: P4 Robustness

**User Story:** As a user dropping a hostile file, I want the app never to crash or hang, so that one bad file can't take the page down (G5).

#### Acceptance Criteria

1. The system SHALL generate inputs from: arbitrary byte arrays (0–64 KiB); each format's magic bytes followed by arbitrary bytes; built curses truncated at a random point; and built curses changed by a list of 1–8 mutations (bit flip, byte overwrite, insertion, deletion, range duplication, and setting a 32-bit length field to an extreme value).
2. The property SHALL assert that `inspect` resolves, never rejects, and returns a value that passes `InspectionSchema`.
3. The property SHALL assert that ghost ids are unique and of the form `${kind}:${n}`, that every confidence is in `[0, 1]`, that every byte location satisfies `0 ≤ start ≤ end ≤ size`, and that every PDF page is ≥ 1.
4. The property SHALL assert that `durationMs ≤ (budgetMs + 250) × PAW_TIME_SLACK`, where `budgetMs = computeBudget(size).budgetMs` (ghost-model spec: 2 s per MiB, at least 1 s, at most 120 s) and 250 ms is the orchestrator's grace period.
5. The system SHALL run each P4 inspection under a hard deadline (a Node `worker_threads` worker in tests; a dedicated Web Worker in the app), and SHALL terminate it at `2 × budget × slack`. A termination SHALL count as a failure with detail `hang`.

### Requirement 8: P5 Original immutability

**User Story:** As a user, I want my original file untouched whatever the app does with it (G2).

#### Acceptance Criteria

1. The system SHALL place each input inside a larger `ArrayBuffer` at a random byte offset, with random canary bytes before and after it, and pass the `Uint8Array` view to `inspect` and then (when an exorcist exists) to `exorcise`.
2. The property SHALL assert that the view's bytes equal a snapshot taken before, that both canaries are unchanged, and that `view.buffer.byteLength` is unchanged (not detached).
3. The property SHALL assert that `exorcism.output` does not share memory with the input view: either `output.buffer !== view.buffer`, or their byte ranges don't overlap.
4. Inputs SHALL include both built curses and P4-style mutated inputs.

### Requirement 9: P6 Nested ghost propagation

**User Story:** As a user, I want ghosts in images pasted into documents to be found and traced to where they are, so that nested leaks are not missed.

#### Acceptance Criteria

1. The system SHALL generate DOCX recipes with 1–3 embedded PNG or JPEG curses, each with at least one planted ghost, and optionally one embedded DOCX layer (depth ≤ 3) holding an image curse.
2. The property SHALL assert that each inner planted ghost is found as an `embedded-media-ghost` whose location is `nested`, with `container: { type: 'zip-entry', path }` equal to the media path, `innerKind` equal to the image format, and `inner` matching the inner planted location, and whose `evidence.raw` passes `isNestedGhostRaw` (core `nested.ts`) with `raw.innerGhost.kind` equal to the planted kind.
3. WHEN the recipe nests the image deeper than depth 3 THEN the property SHALL instead assert that the ghost is not reported, `embedded-media-ghost` is in `unchecked`, and a warning whose code ends in `max-depth` exists.

### Requirement 10: Shrinking

**User Story:** As a developer reading a failure, I want the smallest curse that still breaks the property, so that the cause is obvious.

#### Acceptance Criteria

1. Arbitraries SHALL generate recipes, not bytes, so that every shrunk value still builds a valid file and its manifest.
2. Recipe arbitraries SHALL be built from `fc.record`, `fc.array`, `fc.integer`, `fc.constantFrom`, `fc.oneof` and `fc.letrec`. They SHALL NOT use `fc.chain` for structure. Values that depend on each other (for example, a cover rectangle over a text line) SHALL be stored as relative parameters (per-mille offsets, padding) that the builder turns into geometry.
3. Mutation positions SHALL be stored as per-mille fractions of the input length, so that they stay in range while the input shrinks.
4. Shrinking SHALL move towards fewer ghosts, pages, parts, mutations and revisions, shorter strings, and smaller images (1×1 at minimum).

### Requirement 11: Counterexample serialisation and regression

**User Story:** As a maintainer, I want every curled finger saved as a fixture that is re-checked forever, so that a bug the Paw found can never come back quietly.

#### Acceptance Criteria

1. WHEN a case fails in Node THEN the system SHALL write `fixtures/paw-counterexamples/<property>-<format>-<sha8>.json` and a matching `.bin` holding the shrunk input bytes. `sha8` is the first 8 hex characters of the bytes' SHA-256.
2. The JSON SHALL pass `CounterexampleSchema`: `schema: 1`, `property`, `finger`, `format`, `seed`, `path`, `numShrinks`, `fastCheckVersion`, `palimpsestVersion`, `recipe`, `manifest`, `options` (exorcise options for P2 and P3), `failure` (message plus structured detail), `bytesSha256`, `bytesFile` and `foundAt` (ISO 8601).
3. The regression suite SHALL load every JSON in that folder, check the `.bin` against `bytesSha256`, and re-run the property's check on `(bytes, manifest, options)` without re-building from the recipe, so that generator changes never invalidate old counterexamples.
4. The regression suite SHALL be part of `npm test` (not only `test:paw`), so that a fix is proven on every run.
5. The in-app download SHALL produce the same JSON, with the bytes inline as `bytesBase64`. The regression loader SHALL accept either form.
6. Each committed counterexample SHALL have a one-line entry in `fixtures/paw-counterexamples/README.md` describing the leak it caught (as the `paw-on-extractor-change` hook asks), stored in the JSON's optional `note` field as well. A test SHALL fail if a JSON file has no README line.

### Requirement 12: Run configuration, seeds and CI

**User Story:** As a developer, I want quick local runs, thorough CI runs, and one command to replay any failure, so that the Paw is cheap to run and its failures are easy to reproduce.

#### Acceptance Criteria

1. The system SHALL read `FC_NUM_RUNS` (runs per property, default 200 locally, matching the `paw-on-extractor-change` hook), `PAW_SEED`, `PAW_PATH`, `PAW_PROPERTY`, `PAW_FORMAT`, `PAW_SIZE` (`small` by default locally, `medium` in CI) and `PAW_TIME_SLACK` (1 locally, 3 in CI) only in Node test setup (`paw/node/config.ts`), never in core runtime code.
2. The system SHALL split a property's runs evenly across its formats (at least 10 per case), and SHALL give P4 twice the runs.
3. The system SHALL derive each case's seed as `fnv1a32("<baseSeed>:<property>:<format>")`, and SHALL print `[paw] base seed=<n> runs=<n> size=<s>` at the start of the suite and the case seed in each case name.
4. WHEN `PAW_SEED` is unset THEN the base seed SHALL be random locally, the first 8 hex characters of `GITHUB_SHA` on push and pull-request CI, and random on the nightly run.
5. WHEN `PAW_PROPERTY` and `PAW_FORMAT` are set THEN the system SHALL run only that case, using `PAW_SEED` as the case seed directly, and `PAW_PATH` if given.
6. WHEN a case fails THEN the system SHALL print a replay command (`PAW_SEED=… PAW_PATH=… PAW_PROPERTY=… PAW_FORMAT=… npm run test:paw`), and WHEN `GITHUB_STEP_SUMMARY` is set, SHALL append a Markdown table of failures with those commands.
7. CI SHALL run `test:paw` on push and pull request with `FC_NUM_RUNS=1000`, and a nightly workflow SHALL run it with `FC_NUM_RUNS=10000`. Both SHALL upload `fixtures/paw-counterexamples/` as a build artifact when they fail.
8. A case whose format lacks the needed extractor or exorcist SHALL be reported as skipped with that reason, not as passed, so that the build stays green while formats are added.

### Requirement 13: Summon the Paw (in-app worker)

**User Story:** As a judge or user, I want to run the Paw in my browser and watch it try to beat the exorcist, so that the verification claim is something I can see.

#### Acceptance Criteria

1. The system SHALL run the Paw in a dedicated module Web Worker (`apps/web/src/paw-worker.ts`), lazy-loaded with its dependencies (fast-check, builders), so that none of it is in the initial chunk.
2. The system SHALL validate every message in both directions with zod schemas (`PawRequest`, `PawEvent`).
3. WHEN the user summons the Paw THEN the worker SHALL run every available case with the chosen runs per case (25 by default, 100 or 250 selectable), and with a total time limit of 120 s, shared across cases through `interruptAfterTimeLimit`.
4. The worker SHALL send `progress` events, throttled to at most 10 per second, with property, format, run number, total runs, phase (`running` or `shrinking`) and shrink count. It SHALL send a `finger` event when each finger's state is settled.
5. WHEN the user cancels THEN the main thread SHALL terminate the worker and show "Banished at run N". No partial result SHALL be shown as passed.
6. The worker SHALL use browser adapters for image decode and encode, and SHALL make no network request. The Playwright no-network test SHALL include a full Summon run.

### Requirement 14: The Paw view

**User Story:** As a viewer, I want the hand to show which guarantees held and which broke, and to show the counterexample on the vellum, so that I understand the result without reading test logs.

#### Acceptance Criteria

1. The system SHALL show five fingers, each labelled with its name, guarantee and properties (for example "Index · Detection completeness · P1, P6"). Each finger has a state of `waiting`, `twitching` (running), `held` or `curled`, shown as text as well as by shape and color (never color alone).
2. WHEN any property on a finger fails THEN that finger SHALL curl, in vermilion-500, with a 600 ms motion. WHEN all its properties pass THEN it SHALL stay straight with an lapis-300 outline.
3. For each curled finger, the system SHALL show a counterexample card: property, guarantee, format, case seed, path, shrink count, failure detail, and the planted manifest as a mono table.
4. The card SHALL offer: "Hold a séance on this curse" (opens the normal séance view on the shrunk bytes, in memory); "Copy replay command"; and "Download counterexample" (a local Blob URL, no network).
5. The view SHALL list committed counterexamples from `fixtures/paw-counterexamples/` under "Past catches", loaded lazily at build time, so that the demo can show a real catch from development.
6. WHERE `prefers-reduced-motion` is set, the system SHALL change finger states without motion. Progress SHALL be announced through an `aria-live="polite"` region at most once per second.
7. Every control SHALL be keyboard-reachable, with lapis-300 focus rings and touch targets ≥ 44 px.

### Requirement 15: Tempt the Paw (demo mode)

**User Story:** As a presenter, I want a clearly labelled way to give the Paw a flawed exorcist to catch, so that the demo shows a finger curling on demand.

#### Acceptance Criteria

1. The system SHALL provide a "Tempt the Paw" toggle that, only inside the Paw worker, wraps registered exorcists with known flaws from `paw/tempt.ts` (for example, the PNG exorcist keeps `tEXt` Author chunks, and the DOCX exorcist keeps `word/comments.xml`).
2. WHILE tempted, the view SHALL show the banner "The exorcist has been deliberately weakened for this demo", and every result and counterexample SHALL be marked `tempted: true`.
3. The main inspection worker (`apps/web/src/worker.ts`), the MCP server and the Crew bot SHALL NOT import `paw/tempt.ts`. A dependency-graph test SHALL enforce this.
