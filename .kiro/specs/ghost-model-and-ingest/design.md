# Design Document

## Overview

`packages/core` is a pure TypeScript library that turns a `Uint8Array` into an `Inspection` (the Séance Ledger's data) or an `Exorcism` (a clean copy plus proof). This spec designs the parts that every format shares:

1. **Sniffing**: a synchronous, allocation-light check of magic bytes that returns a `FileKind`.
2. **Registries**: maps from `FileKind` to `Extractor` and `Exorcist`. Lazy entries keep `pdfjs-dist`, `pdf-lib` and `jszip` out of the initial bundle.
3. **The orchestrator** (`inspect`, `exorcise`): a wrapper around one extractor call that enforces the guarantees. Extractors are trusted to be correct but not to be well-behaved, so the orchestrator never throws (G5), sets a time budget (G5), applies the `unchecked` rules (G6), limits nesting depth, assigns ids and orders ghosts.
4. **The worker boundary**: a versioned, zod-validated protocol between `apps/web` and a module Web Worker, so parsing never blocks the main thread.

The design stays inside `types.ts`. Three small additions are needed. They are listed under "Proposed change to types.ts".

## Architecture

### File layout

```
packages/core/src/
  types.ts                  (existing, plus the proposed additions)
  ghost-kinds.ts            GHOST_KINDS re-export, carries table (CARRIES)
  schema.ts                 zod schemas mirroring types.ts (+ schema.typetest.ts)
  formats/
    sniff.ts                sniff(), sniffDetailed()
    zip-names.ts            central-directory / local-header name scan (no inflate)
  registry/
    registry.ts             createRegistry, Registry, Lazy<T>, RegistryError
    default.ts              defaultRegistry (eager png/jpeg/heic, lazy pdf/docx)
  orchestrator/
    inspect.ts              inspectWith(registry, bytes, opts, depth)
    exorcise.ts             exorciseWith(registry, ...) (pipeline detail: exorcism spec)
    budget.ts               computeBudget(), linkSignals(), withGrace()
    finalize.ts             normalizeGhosts(): clamp, sort, assign ids
    unchecked.ts            computeUnchecked()
  nested.ts                 nestGhosts()
  util/bytes.ts             readU16BE/LE, readU32BE/LE, indexOf(bytes, needle, from, to)
  index.ts                  inspect, exorcise, createCore, sniff, isVerifiedClean, nestGhosts, schemas
apps/web/src/
  worker.ts                 worker entry: queue, cancel, prior cache
  worker-protocol.ts        zod request/response schemas
  worker-client.ts          main-thread client: request(), watchdog, respawn
```

### Data flow

```mermaid
flowchart LR
  subgraph Main thread
    D[Drop zone File] -->|File.arrayBuffer() fresh copy| C[worker-client]
    C -->|watchdog budget+5s| C
  end
  subgraph Worker
    W[worker.ts<br/>zod parse, FIFO queue] --> I[inspect]
    I --> S[sniff]
    S --> R{registry.extractor kind}
    R -->|missing / unknown| U[unchecked = carries or all kinds]
    R -->|Lazy load once| E[Extractor.extract bytes, ctx]
    E -->|ctx.inspectNested depth+1 ≤ 3| I
    E --> F[finalize: clamp, sort, ids, unchecked]
    B[budget.ts linkSignals<br/>user signal + timeout] -.ctx.signal.-> E
  end
  C -- "postMessage {v:1,type:'inspect',id,bytes} (transfer)" --> W
  F -- "{v:1,type:'inspection',id,inspection} (transfer previews)" --> C
```

### Inspect sequence

1. Validate the input at runtime: `bytes instanceof Uint8Array`. Otherwise resolve with `invalid-input`.
2. Start `t0 = performance.now()`. Compute `kind = sniff(bytes)` and `budgetMs`.
3. Apply the short-circuit checks in this order: pre-aborted signal (6.4), size over 200 MiB (10.1), `unknown` (4.2), no extractor (4.3), lazy load failure (3.5).
4. Build `ctx: ExtractContext = { signal, depth, adapters, inspectNested }`.
5. Run `Promise.resolve().then(() => extractor.extract(bytes, ctx))` inside `try`. Calling inside `then` turns synchronous throws into rejections. Race it against `abortedPlusGrace(signal, 250)`.
6. Validate the result with `ExtractResultSchema`. Normalize it: clamp confidence, sort, assign ids, compute `unchecked`. Add `durationMs`.

## Components and Interfaces

```ts
// packages/core/src/index.ts
export function inspect(bytes: Uint8Array, opts?: InspectOptions): Promise<Inspection>;
export function exorcise(
  bytes: Uint8Array,
  opts?: ExorciseOptions,
  run?: InspectOptions & { prior?: Inspection },
): Promise<Exorcism>;
export function createCore(registry: Registry): { inspect: typeof inspect; exorcise: typeof exorcise };
export function isVerifiedClean(i: Inspection): boolean;
export { sniff, sniffDetailed } from './formats/sniff';
export { nestGhosts } from './nested';
export { GHOST_KINDS, CARRIES, carries } from './ghost-kinds';

// packages/core/src/formats/sniff.ts
export function sniff(bytes: Uint8Array): FileKind;
export function sniffDetailed(bytes: Uint8Array): { kind: FileKind; reason: SniffReason };
export type SniffReason =
  | 'png-signature' | 'jpeg-soi' | `pdf-header@offset=${number}`
  | 'heic-ftyp' | 'avif-ftyp' | 'docx-central-directory' | 'docx-local-headers'
  | 'zip-without-word-document' | 'empty' | 'no-signature';

// packages/core/src/formats/zip-names.ts
/** Returns entry names, never inflating. Stops at maxEntries. Never throws. */
export function zipEntryNames(bytes: Uint8Array, maxEntries?: number): { names: string[]; via: 'cd' | 'local' | 'none' };

// packages/core/src/registry/registry.ts
export type Lazy<T extends { kind: FileKind }> = T | { kind: FileKind; load: () => Promise<T> };
export interface Registry {
  extractor(kind: FileKind): Promise<Extractor | undefined>;   // undefined: none registered
  exorcist(kind: FileKind): Promise<Exorcist | undefined>;
  kinds(): { extractors: FileKind[]; exorcists: FileKind[] };
}
export class RegistryError extends Error {
  constructor(readonly code: 'duplicate-kind' | 'unknown-kind-not-registrable', message: string);
}
export function createRegistry(entries: { extractors: Lazy<Extractor>[]; exorcists: Lazy<Exorcist>[] }): Registry;

// packages/core/src/orchestrator/budget.ts
export function computeBudget(size: number, override?: number): { budgetMs: number; warning?: Warning };
/** Combines signals without AbortSignal.any (not in every target); reason is 'budget' | 'caller'. */
export function linkSignals(caller: AbortSignal | undefined, budgetMs: number):
  { signal: AbortSignal; reason(): 'budget' | 'caller' | null; dispose(): void };
export function withGrace<T>(work: Promise<T>, signal: AbortSignal, graceMs: number):
  Promise<{ status: 'done'; value: T } | { status: 'failed'; error: unknown } | { status: 'timeout' }>;

// packages/core/src/orchestrator/finalize.ts
export function normalizeGhosts(ghosts: readonly Ghost[], warnings: Warning[]): Ghost[];
export function locationSortKey(l: GhostLocation): [number, number | string];

// packages/core/src/orchestrator/unchecked.ts
export function computeUnchecked(args: {
  kind: FileKind; detects: readonly GhostKind[]; reported: readonly GhostKind[]; forced: readonly GhostKind[];
}): GhostKind[];

// packages/core/src/nested.ts
export interface NestedGhostRaw { innerGhost: Ghost }
export function nestGhosts(inner: Inspection, container: GhostLocation): Ghost[];
export function isNestedGhostRaw(raw: unknown): raw is NestedGhostRaw;
```

### Worker protocol (`apps/web/src/worker-protocol.ts`)

```ts
const Id = z.string().uuid();
export const WorkerRequestSchema = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('inspect'), id: Id,
             bytes: z.instanceof(Uint8Array), budgetMs: z.number().int().min(1).max(600_000).optional() }),
  z.object({ v: z.literal(1), type: z.literal('exorcise'), id: Id,
             bytes: z.instanceof(Uint8Array), options: ExorciseOptionsSchema, priorId: Id.optional() }),
  z.object({ v: z.literal(1), type: z.literal('cancel'), id: Id }),
]);
export const WorkerResponseSchema = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('ready') }),
  z.object({ v: z.literal(1), type: z.literal('progress'), id: Id,
             stage: z.enum(['sniff', 'extract', 'nested', 'exorcise', 'verify']) }),
  z.object({ v: z.literal(1), type: z.literal('inspection'), id: Id, inspection: InspectionSchema }),
  z.object({ v: z.literal(1), type: z.literal('exorcism'), id: Id, exorcism: ExorcismSchema }),
  z.object({ v: z.literal(1), type: z.literal('failed'), id: z.union([Id, z.literal('')]),
             code: z.enum(['invalid-message', 'cancelled', 'internal']), message: z.string().max(300) }),
]);
export type WorkerRequest = z.infer<typeof WorkerRequestSchema>;
export type WorkerResponse = z.infer<typeof WorkerResponseSchema>;

// apps/web/src/worker-client.ts
export interface WorkerClient {
  inspect(file: File, opts?: { budgetMs?: number }): { id: string; result: Promise<Inspection> };
  exorcise(file: File, options: ExorciseOptions, priorId?: string): { id: string; result: Promise<Exorcism> };
  cancel(id: string): void;
  onProgress(cb: (id: string, stage: string) => void): () => void;
}
export function createWorkerClient(factory?: () => Worker): WorkerClient;
```

Bytes cross the boundary as `Uint8Array` by structured clone. The underlying `ArrayBuffer` is listed in the transfer list. `z.instanceof(Uint8Array)` works in both realms because structured clone recreates the object in the receiving realm. `Uint8ClampedArray` never crosses the boundary.

## Data Models

### Proposed change to types.ts

These are additive. No existing member changes.

```ts
/** Canonical order of ghost kinds (drives `unchecked` ordering, schemas and the Paw). */
export const GHOST_KINDS: readonly GhostKind[] = [
  'trailing-data', 'recovered-image', 'embedded-thumbnail', 'gps-location', 'device-identity',
  'software-trail', 'capture-time', 'author-identity', 'icc-profile-identity', 'text-in-pixels',
  'unredacted-text', 'prior-revision', 'pdf-metadata', 'hidden-annotation', 'embedded-file',
  'tracked-change', 'comment', 'revision-id', 'docx-properties', 'embedded-media-ghost',
] as const;

/** Options for a top-level inspect/exorcise call. */
export interface InspectOptions {
  signal?: AbortSignal;
  /** Override the default budget (2 s per MiB, min 1 s, max 120 s). Integer 1..600000. */
  budgetMs?: number;
  adapters?: PlatformAdapters;
}
```

The `exorcism` spec proposes two more optional members (`PlatformAdapters.rasterizePdfPage` and `ExtractContext.exorciseNested`) and tightens the adapter doc comments. The `types-changed` hook keeps the three specs in sync when these land.

Exhaustiveness check (in `ghost-kinds.ts`): `type _Missing = Exclude<GhostKind, (typeof GHOST_KINDS)[number]>; const _check: [_Missing] extends [never] ? true : never = true;`.

### carries(kind)

This table is the fixed list of ghost kinds each format can hold, based on the format specs. It is not the list of what we detect. The gap between the two is what fills `unchecked`.

| FileKind | carries |
|---|---|
| `png` | trailing-data, recovered-image, embedded-thumbnail, gps-location, device-identity, software-trail, capture-time, author-identity, icc-profile-identity, text-in-pixels |
| `jpeg` | same as `png` |
| `heic` | trailing-data, embedded-thumbnail, gps-location, device-identity, software-trail, capture-time, author-identity, icc-profile-identity, text-in-pixels |
| `pdf` | unredacted-text, prior-revision, pdf-metadata, hidden-annotation, embedded-file, author-identity, software-trail, capture-time, embedded-media-ghost, text-in-pixels |
| `docx` | tracked-change, comment, revision-id, docx-properties, author-identity, software-trail, capture-time, embedded-media-ghost (+ hidden-text, alt-text if the docx-ghosts type change lands) |
| `unknown` | all of `GHOST_KINDS` |

`text-in-pixels` (OCR) is not detected by any v1 extractor, so it always shows up in `unchecked` for images and PDFs. This is intended: it puts "text inside pictures" in the "What we can't see" panel.

### Sniff algorithm details

- **PNG**: compare all 8 signature bytes (PNG spec, W3C PNG Third Edition §5.2). Matching only `89 50 4E 47` would accept truncated or text-mode-mangled files. Those fail the full check and become `unknown`.
- **JPEG**: `FF D8 FF` (ITU-T T.81 Annex B: SOI followed by the first marker's `FF`).
- **PDF**: search `%PDF-` with `indexOf` limited to `[0, 1024)`.
- **HEIC (ISO/IEC 14496-12 / 23008-12)**: `ftyp` box at offset 0: `size(u32 BE) 'ftyp' major_brand(4) minor_version(4) compatible_brands(4×n)`. Read compatible brands up to `min(size, byteLength, 64)`.
- **DOCX (ECMA-376 Part 2 OPC on PKWARE APPNOTE 6.3.x ZIP)**: find the EOCD `50 4B 05 06` by scanning backwards from `len-22` to `max(0, len-65557)`. Read the central directory offset (EOCD+16, u32 LE), its size (EOCD+12) and the entry count (EOCD+10). Walk the central-directory headers `50 4B 01 02`: name length at +28, extra length at +30, comment length at +32, name at +46. Decode names as UTF-8 when general-purpose bit 11 is set, otherwise as CP437. ASCII is enough for the two target names. IF the count is `0xFFFF` or the offset is `0xFFFFFFFF` (ZIP64), or a header signature does not match, THEN fall back to local headers `50 4B 03 04`: name length at +26, extra length at +28, name at +30, skip by compressed size at +18. When bit 3 (data descriptor) is set and the size is 0, search forward for the next `50 4B 03 04`. Nothing is inflated.

### Ghost ordering key

| Location type | Primary key | Secondary |
|---|---|---|
| `byte-range`, `chunk`, `pdf-revision` | `start` | — |
| `pdf-region` | `page` | `rect.y` descending (top of page first in PDF user space) |
| `zip-entry` | path (code-point order) | — |
| `nested` | key of `container` | key of `inner` |

## Error Handling

The orchestrator owns all error containment. Warning codes:

| Code | Raised when | Effect on `unchecked` |
|---|---|---|
| `invalid-input` | runtime input is not a `Uint8Array` | all kinds |
| `unsupported-format` | sniff = unknown | all kinds |
| `no-extractor` / `no-exorcist` | kind not registered | carries(kind) |
| `extractor-load-failed` / `exorcist-load-failed` | lazy import rejected or wrong kind | carries(kind) |
| `extractor-crashed` | throw or reject | ⊇ detects |
| `extractor-invalid-result` | result fails `ExtractResultSchema` | ⊇ detects |
| `budget-exceeded` / `aborted` | internal or caller signal aborted | carries(kind) |
| `max-depth` | nested depth would be 4 | carries(innerKind) in the refused inspection; the orchestrator adds embedded-media-ghost to every ancestor |
| `file-too-large` | over 200 MiB | carries(kind) |
| `decompression-limit` | 64 MiB per stream / 256 MiB per call | affected kinds |
| `invalid-confidence`, `invalid-option`, `detects-exceeds-carries` | normalization | none |
| `nested:<code>` | copied from a nested inspection | embedded-media-ghost |
| `worker-timeout` (web only) | watchdog fired | carries(kind) |

Error messages are built with `describeError(e)`. It returns `${name}: ${message.slice(0,200)}` and never `String(e)` of arbitrary objects, which could serialize file bytes. Stack traces are dropped.

`createRegistry` is the only function that throws. It runs at module initialization with code-defined inputs.

## Correctness Properties

Each property is one fast-check test in a `*.prop.test.ts` file next to its module. Defaults: `numRuns: 200`; fuzz properties use `numRuns: 1000` in CI nightly.

- **Property 1 (PNG sniff)**: For any byte string `s`, `sniff(PNG_SIG ++ s) === 'png'`.
- **Property 2 (JPEG sniff)**: For any byte string `s`, `sniff([0xFF,0xD8,0xFF] ++ s) === 'jpeg'`.
- **Property 3 (PDF window)**: For any prefix `p` with `len(p) ≤ 1019` that contains no PNG/JPEG signature at offset 0 and does not contain `%PDF-`, and any suffix `s`, `sniff(p ++ "%PDF-" ++ s) === 'pdf'`. For `len(p) ≥ 1020` (and no `%PDF-` in `p`) the result is not `'pdf'`.
- **Property 4 (HEIC brands)**: For any major brand `b` ∈ {heic, heix, mif1} and any compatible-brand list `L` that does not make it AVIF under 2.5, a well-formed `ftyp` box gives `'heic'`. For `b = mif1` and `L ∋ avif` with no HEVC brand, the result is `'unknown'`.
- **Property 5 (DOCX names)**: For any set `N` of ZIP entry names (written by a test ZIP writer, stored or deflated, with or without data descriptors), `sniff(zip(N)) === 'docx'` iff `{'[Content_Types].xml', 'word/document.xml'} ⊆ N`.
- **Property 6 (sniff totality)**: For any `Uint8Array` `b` of length 0..65,536, `sniff(b)` returns a member of `FileKind`, does not throw, and `sniff(b) === sniff(b.slice())`.
- **Property 7 (never reject)**: For any `Uint8Array` `b` (arbitrary bytes; also any known fixture with random bit flips, truncation at a random offset, or a random splice of 1–512 bytes), `await inspect(b)` resolves and `InspectionSchema.safeParse(result).success`.
- **Property 8 (size and kind)**: For any `b`, `inspect(b).size === b.byteLength` and `inspect(b).kind === sniff(b)`. For any view `v = b.subarray(i, j)`, every byte offset in `inspect(v)` lies in `[0, j - i]`.
- **Property 9 (ids)**: For any inspection result, ids are unique, each matches `^${kind}:(0|[1-9]\d*)$`, and for each kind the set of `n` is exactly `{0, …, count-1}`.
- **Property 10 (order)**: For any list of ghosts emitted by a stub extractor, `normalizeGhosts` output is sorted by `(severityRank, locationSortKey, emissionIndex)` and is a permutation of the input (by content).
- **Property 11 (unchecked algebra)**: For any stub extractor with random `detects ⊆ carries(k)` and random returned `unchecked`, the inspection's `unchecked` equals `sortCanonical((carries(k) \ detects) ∪ (reported ∩ carries(k)))`, has no duplicates, and `unchecked ⊆ carries(k)`.
- **Property 12 (unknown honesty)**: For any `b` with `sniff(b) === 'unknown'`, `inspect(b)` has `ghosts.length === 0`, `unchecked` deep-equals `GHOST_KINDS`, and `isVerifiedClean` is `false`.
- **Property 13 (crash containment)**: For any thrown value `e` (including non-Error values, objects with throwing getters, and synchronous throws), a stub extractor that throws `e` gives an inspection with exactly one `extractor-crashed` warning, a message of ≤ 300 characters, and `unchecked ⊇ detects`.
- **Property 14 (budget)**: With fake timers, for any `budgetMs` in `[1, 10000]` and a stub extractor that never resolves, `inspect` resolves at virtual time ≤ `budgetMs + 250` with warning `budget-exceeded` and `unchecked = carries(kind)`.
- **Property 15 (cooperative partial)**: For any `k` in `[0, 50]`, a stub extractor that emits `k` ghosts, then waits for abort, then returns them gives an inspection with exactly `k` ghosts after a caller abort, plus warning `aborted`.
- **Property 16 (depth)**: For any input `b` whose kind is served by a stub extractor that calls `ctx.inspectNested(b, ctx)` `m ∈ [1, 3]` times, the extractor runs at depths 0..3 only (it is never called with `depth > 3`), the top-level warnings contain `nested:nested:nested:nested:max-depth` (refused at depth 4, then copied up through depths 3, 2, 1 and 0), `unchecked ∋ 'embedded-media-ghost'`, and the call resolves.
- **Property 17 (nestGhosts)**: For any inner inspection `I` and container location `c`, `nestGhosts(I, c)` has the same length as `I.ghosts`, every element has kind `embedded-media-ghost`, location `{type:'nested', container: c, inner: g.location, innerKind: I.kind}`, and severity and confidence equal to the inner ghost's.
- **Property 18 (determinism)**: For any fixture `f`, two calls of `inspect(f)` are deep-equal after deleting `durationMs`.
- **Property 19 (protocol round trip)**: For any request or response produced by a fast-check arbitrary derived from the schemas, `Schema.parse(structuredClone(m))` deep-equals `m`.
- **Property 20 (protocol rejection)**: For any JSON-like value `x` that is not a valid request, the worker handler replies with exactly one `failed` message with code `invalid-message`, and the next valid request still gets its terminal response.
- **Property 21 (verified clean)**: For any inspection `i`, `isVerifiedClean(i)` implies `i.ghosts.length === 0 && i.unchecked.length === 0`.

## Testing Strategy

- **Unit tests (vitest)**: Example-based tests for each sniff rule, with one hand-built fixture per row (PNG, JPEG/JFIF, JPEG/Exif, `%PDF-` at offset 0 and at offset 37, HEIC `heic`, `mif1`+`heic`, AVIF `mif1`+`avif`, DOCX, XLSX, ZIP64 DOCX, EPUB). Also: `computeBudget` boundaries (0 B → 1000 ms, 1 MiB → 2000 ms, 100 MiB → 120000 ms); `createRegistry` duplicate and `unknown` errors; lazy-load caching (a load spy is called once for two concurrent calls); `isVerifiedClean` truth table.
- **Property tests (fast-check)**: Properties 1–21 above, in `formats/sniff.prop.test.ts`, `orchestrator/inspect.prop.test.ts`, `nested.prop.test.ts` and `apps/web/src/worker-protocol.prop.test.ts`. Stub extractors live in `packages/core/test-support/stubs.ts` (`throwing(e)`, `hanging()`, `emitting(ghosts)`, `recursing()`), so orchestrator properties don't depend on real formats.
- **Type tests**: `schema.typetest.ts`, compiled by `tsc --noEmit` in CI, asserts mutual assignability (Requirement 11.2) using `expectTypeOf` from vitest.
- **Worker tests**: The worker's message handler is a pure function `handle(msg, deps)` that is unit-tested in Node with a fake `postMessage`. A Playwright test drops a 30 MiB generated PDF and asserts that the main thread's longest task during inspection is under 100 ms (`PerformanceObserver` `longtask`).
- **Fixtures**: Sniffing fixtures are generated by `scripts/make-fixtures.ts` into `fixtures/haunted-gallery/sniff/`. They are deterministic, committed and contain only synthetic data.
- **G1**: The ESLint rule (Requirement 12.1) runs in `npm run lint`. The Playwright no-network test from the threat model covers the running app.
