# Implementation Plan

Prerequisite: `packages/core` exports `inspect`, `exorcise`, `sniff` and the extractor/exorcist registries from `src/index.ts` (core spec). Every task ends with `npm run typecheck && npm test -w packages/mcp` (and `-w packages/core` for task 1) green.

- [ ] 1. Shared core helpers
  - [ ] 1.1 Add `RedactedGhost` to `packages/core/src/types.ts` (proposed change in design.md) and run the `types-changed` hook.
    - _Requirements: 10.3_
  - [ ] 1.2 Implement `packages/core/src/ghost-kinds.ts` (`GHOST_KIND_INFO` as `Record<GhostKind, GhostKindInfo>`) with a test that compares its keys to every kind in the registries' `detects`.
    - _Requirements: 10.2, 5.4_
  - [ ] 1.3 Implement `packages/core/src/redact.ts` (`redactGhost`, `redactedCounts`) reading only the allowed fields, plus the marker-string property test.
    - _Requirements: 10.3, 10.4_
  - [ ] 1.4 Implement `packages/core/src/node.ts` (`nodeAdapters` with `pngjs` and `jpeg-js`), the `./node` subpath export, and round-trip tests on generated images.
    - _Requirements: 10.1_

- [ ] 2. Package scaffold and CLI
  - [ ] 2.1 Create `packages/mcp/package.json` (bin, `files`, exact `@modelcontextprotocol/sdk` and `zod` versions, `@palimpsest/core` workspace dependency), `tsconfig.json` and a `cli.ts` shebang entry.
    - _Requirements: 8.3, 15.1, 15.2_
  - [ ] 2.2 Implement `config.ts` and `parseCli` (`--root` realpath, `--max-bytes`, `--read-only`, `--evidence`), exit code 2 on errors, stderr-only logging, exit on stdin close; table tests.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 3. Sandbox and limits
  - [ ] 3.1 Implement `isInside`, `resolveInput` and `readAll` (NUL check, realpath, `O_NOFOLLOW`, handle `fstat`, size check before read, relative-only error paths) with temp-tree tests including symlinks in and out of root, FIFOs and `..foo` names.
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 7.1_
  - [ ] 3.2 Implement `resolveOutput` and `writeAtomic` (parent realpath, no existing file or symlink, not the input, exclusive temp, link-or-rename without overwrite, temp cleanup on failure); tests for P2 and leftover temp files.
    - _Requirements: 4.3, 6.4, 6.6_
  - [ ] 3.3 Implement `budgetMs`, the FIFO `Semaphore(2)` and `capResultSize`; tests for P7.
    - _Requirements: 7.2, 7.3, 7.4_

- [ ] 4. Errors and summaries
  - [ ] 4.1 Implement `errors.ts` (`ToolFailure`, `toolError`, the ten codes) with tests that failures are tool results, not JSON-RPC errors.
    - _Requirements: 9.1, 9.2, 9.3_
  - [ ] 4.2 Implement `summarize.ts` (`toInspectSummary` in redacted and full modes, `toText`, `checked`, counts for all severities, 512-character truncation) with snapshot tests and P6.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 5. Server and tools
  - [ ] 5.1 Implement `server.ts` with `McpServer` + `StdioServerTransport`, and `tools/inspect-file.ts` (raw-shape input schema, full re-parse with exactly-one-of, base64 length check before decode, path or bytes → core `inspect` with `nodeAdapters` and the time budget).
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 7.2_
  - [ ] 5.2 Implement `tools/exorcise-file.ts` (kinds enum, default `<stem>.clean.<ext>`, `UNSUPPORTED_KIND`, survivor check, atomic write, `ExorciseResult`) and skip registration under `--read-only`.
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 1.3_
  - [ ] 5.3 Implement `resources/ghost-kinds.ts` with `detectedIn` / `removedFrom` computed from the registries.
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 6. Integration and no-network tests
  - [ ] 6.1 SDK-client integration suite over stdio against a temp root of Haunted Gallery fixtures: list tools, both tools in every mode, the resource, stdout-only-JSON-RPC check; assert P3, P4, P9.
    - _Requirements: 1.5, 3.1, 4.4, 4.5, 4.6, 5.2_
  - [ ] 6.2 Add the network tripwire setup file, run the suite under it (P8), and extend `scripts/check-no-network.ts` to `packages/mcp/src` with Node network module names.
    - _Requirements: 8.1, 8.2_

- [ ] 7. Kiro Power `exorcist-power`
  - [ ] 7.1 Write `power/exorcist-power/POWER.md` (manifest frontmatter marked "verify against current Kiro Powers docs", usage body) and `mcp.json` pinned to the package version with `inspect_file` auto-approved.
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [ ] 7.2 Write `steering/scrub-attachments.md` per Requirement 12 with one worked example.
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [ ] 7.3 Write `hooks/inspect-new-attachment.kiro.hook` and `hooks/scrub-staged-attachments.kiro.hook` (schema marked "verify against current Kiro hooks docs").
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  - [ ] 7.4 Add the power consistency test (P10): parse manifest, `mcp.json` and hooks with zod; version equality; tool names registered.
    - _Requirements: 11.5_

- [ ] 8. Dogfooding
  - [ ] 8.1 Add `.kiro/settings/mcp.json` running `npx tsx packages/mcp/src/cli.ts --root . --read-only --evidence full` with `autoApprove: ["inspect_file"]`, and a smoke test that the command answers `initialize`.
    - _Requirements: 14.1_
  - [ ] 8.2 Update the `haunted-asset-guard` hook prompt to call `inspect_file` on new `fixtures/` files and check GPS against the public-landmark list; record one real session example in `docs/KIRO_WRITEUP`.
    - _Requirements: 14.2, 14.3_

- [ ] 9. Documentation and release
  - Write `packages/mcp/README.md` (flags, tools with example inputs/outputs, resource, error codes, redaction default), add `LICENSE`, verify `npm pack --dry-run` lists only `dist/`, `README.md`, `LICENSE`, `power/`.
  - _Requirements: 15.2, 15.3_
