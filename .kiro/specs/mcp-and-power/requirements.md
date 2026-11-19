# Requirements Document

## Introduction

This spec covers two deliverables for developers and agents:

1. **`packages/mcp`**: a local MCP server (`@modelcontextprotocol/sdk`, stdio transport) that exposes Palimpsest's core to any MCP client. Tools: `inspect_file` (find ghosts) and `exorcise_file` (write a clean copy and verify it). Resource: `palimpsest://ghost-kinds` (what each `GhostKind` means). The server runs `packages/core` in Node, validates every input with zod, only touches files inside an allowed root given on the command line, enforces size and time limits, and never uses the network.
2. **`exorcist-power`**: a Kiro Power that bundles the server's MCP configuration, a steering file telling agents to scrub attachments before uploading or committing them, and a hook that prompts a scan when an image, PDF or DOCX enters the workspace.

It also covers dogfooding: the Palimpsest repo registers the local server in `.kiro/settings/mcp.json` so Kiro can call `inspect_file` while the project is being built.

Every result is derived from the shapes in `packages/core/src/types.ts` (`Inspection`, `Ghost`, `Exorcism`, `GhostKind`, `Severity`, `SEVERITY_ORDER`, `FileKind`). A privacy point shapes the output design: MCP results land in an agent's context, which is usually sent to a remote model. So the server returns **redacted** evidence by default ("GPS present", not coordinates), and full evidence values only when the user starts the server with `--evidence full`.

Three small shared modules are added to `packages/core` for this spec and reused by the `crew-bot` spec: Node platform adapters (`@palimpsest/core/node`), a ghost-kind catalogue, and a redaction helper. None changes `types.ts`.

Exact Kiro Power manifest field names and the hook file schema are marked **verify against current Kiro Powers docs**.

## Requirements

### Requirement 1: Server start-up and CLI

**User Story:** As a developer, I want to start the server with one command that names the folder it may touch, so that I control what an agent can read and write.

#### Acceptance Criteria

1. The package SHALL provide a bin `palimpsest-mcp` that starts an MCP server over stdio with server name `palimpsest` and the package version.
2. The CLI SHALL require `--root <dir>`; IF it is missing, does not exist or is not a directory THEN the process SHALL print a usage error to stderr and exit with code 2 without starting the server.
3. The CLI SHALL accept `--max-bytes <n>` (default 52,428,800; allowed 1 to 209,715,200), `--read-only` (do not register `exorcise_file`), and `--evidence redacted|full` (default `redacted`); invalid values SHALL exit with code 2.
4. The server SHALL resolve `--root` with `fs.realpath` once at start-up and use only that canonical path for sandbox checks.
5. The server SHALL write nothing to stdout except MCP protocol messages; all logs SHALL go to stderr.
6. WHEN stdin closes THEN the server SHALL exit with code 0 within 1 s.

### Requirement 2: `inspect_file` input

**User Story:** As an agent, I want to inspect a file by path or by inline bytes, so that I can check attachments that are not yet saved to disk.

#### Acceptance Criteria

1. The tool `inspect_file` SHALL accept `{ path?: string, base64?: string, max_bytes?: integer }`, validated with zod.
2. IF neither or both of `path` and `base64` are given THEN the tool SHALL return an `INVALID_INPUT` error.
3. `max_bytes` SHALL be an integer from 1 to the server's `--max-bytes`; it can only lower the limit; IF it is larger THEN the tool SHALL return `INVALID_INPUT`.
4. WHEN `base64` is given THEN the tool SHALL reject it with `TOO_LARGE` before decoding IF `floor(length × 3 / 4)` exceeds the effective limit, and SHALL reject strings that are not valid standard or URL-safe base64 with `INVALID_INPUT`.
5. WHEN `path` is given THEN the file SHALL be resolved and opened under the sandbox rules of Requirement 6.

### Requirement 3: `inspect_file` output

**User Story:** As an agent, I want a compact, structured summary of the ghosts, so that I can decide whether a file is safe to share without flooding my context.

#### Acceptance Criteria

1. The tool SHALL return `structuredContent` matching the `InspectSummary` schema in the design and a `text` content item with a human summary (for example "PNG, 412 KB: 7 ghosts (2 wraith, 3 shade, 2 wisp). Unchecked: text-in-pixels.").
2. `InspectSummary.counts` SHALL contain every `Severity` in `SEVERITY_ORDER` as a key, with zero for absent severities, and `total` SHALL equal `ghosts.length`.
3. Each ghost in the summary SHALL include `id`, `kind`, `severity`, `title`, `explanation`, `confidence`, `location` and `evidence.summary`; it SHALL NOT include `evidence.preview` or `evidence.raw`.
4. WHEN the server runs with `--evidence redacted` THEN each ghost's `evidence.summary` SHALL be the redacted summary from the core redaction helper, `evidence.fields` SHALL be omitted, and `title` SHALL be the catalogue title for its kind.
5. WHEN the server runs with `--evidence full` THEN `evidence.summary` and `evidence.fields` values SHALL be included, each truncated to 512 characters with a trailing "…".
6. The summary SHALL include `kind`, `size`, `durationMs`, `warnings` (code, message, offset) and `unchecked` from the `Inspection`.
7. IF `Inspection.kind` is `unknown` THEN the text item SHALL say "Unknown file type: nothing was checked." and `structuredContent.checked` SHALL be `false`; for every other kind `checked` SHALL be `true` (G6).

### Requirement 4: `exorcise_file`

**User Story:** As an agent, I want to write a cleaned copy of a file and get proof it is clean, so that I can upload the copy instead of the original.

#### Acceptance Criteria

1. Unless `--read-only` is set, the tool `exorcise_file` SHALL accept `{ path: string, out_path?: string, kinds?: GhostKind[] }`, validated with zod, with `kinds` restricted to the `GhostKind` union and de-duplicated.
2. WHEN `out_path` is omitted THEN the output path SHALL be `<dir>/<stem>.clean.<ext>` next to the input, with `<ext>` derived from the output's sniffed `FileKind`.
3. The output path SHALL satisfy the sandbox rules of Requirement 6, SHALL NOT resolve to the input file, and SHALL NOT exist; IF it exists THEN the tool SHALL return `OUT_EXISTS`.
4. The tool SHALL call core `exorcise` with `ExorciseOptions.kinds` set to `kinds` when given, and SHALL never modify the input file (G2).
5. IF the `verification` inspection contains any ghost whose kind is in the requested kinds (or in the exorcist's `removes` when `kinds` is omitted) THEN the tool SHALL NOT write the output and SHALL return `SURVIVORS` listing the surviving ghosts in the same form as Requirement 3.
6. WHEN verification passes THEN the tool SHALL write the output atomically (temporary file in the same directory opened with exclusive create, then moved into place without overwriting any file that appeared meanwhile) and return `structuredContent` with `out_path` (relative to root), `kind`, `bytes_in`, `bytes_out`, `banished`, `verification` (summary per Requirement 3) and `warnings`.
7. IF the input kind is `unknown` OR no exorcist exists for it THEN the tool SHALL return `UNSUPPORTED_KIND` and write nothing.

### Requirement 5: `palimpsest://ghost-kinds` resource

**User Story:** As an agent, I want a reference for every ghost kind, so that I can explain findings to the user.

#### Acceptance Criteria

1. The server SHALL expose a resource at URI `palimpsest://ghost-kinds` with MIME type `application/json`.
2. The resource SHALL list every `GhostKind` exactly once with `kind`, `title`, `description`, `typicalSeverity`, `detectedIn` (FileKinds whose extractor `detects` it) and `removedFrom` (FileKinds whose exorcist `removes` it).
3. `detectedIn` and `removedFrom` SHALL be computed from the core registries at start-up, not hard-coded.
4. A test SHALL fail IF the catalogue is missing a member of the `GhostKind` union.

### Requirement 6: Path sandbox

**User Story:** As a user, I want the server to be unable to touch anything outside the folder I allowed, so that a confused or malicious prompt cannot read my SSH keys or overwrite my files.

#### Acceptance Criteria

1. The server SHALL reject paths containing a NUL byte with `INVALID_INPUT`.
2. The server SHALL resolve a relative path against the root and accept an absolute path only if it is inside the root.
3. For an input path the server SHALL resolve symlinks with `fs.realpath` and return `OUTSIDE_ROOT` IF `path.relative(root, real)` equals `..`, starts with `..` followed by a path separator, or is absolute (a different drive on Windows).
4. For an output path the server SHALL apply the same check to the `realpath` of its parent directory and SHALL reject a final component that is an existing symlink.
5. The server SHALL open the input once, then `fstat` the handle and return `NOT_A_FILE` IF it is not a regular file, and SHALL read only from that handle (no second open by name).
6. WHERE the platform defines `O_NOFOLLOW`, the server SHALL include it when opening the input and output.
7. Error messages SHALL show paths relative to the root and SHALL NOT reveal the absolute root or the resolved target of a rejected path.

### Requirement 7: Size and time limits

**User Story:** As a developer, I want hard limits on work per call, so that a huge or malicious file cannot exhaust the machine.

#### Acceptance Criteria

1. IF a file's `fstat` size exceeds the effective limit THEN the tool SHALL return `TOO_LARGE` without reading it.
2. Each tool call SHALL run with an `AbortSignal` that fires after `max(5000, 2000 × size_in_MB)` ms, capped at 120,000 ms; WHEN it fires THEN the tool SHALL return `TIMEOUT` with any warnings collected.
3. The server SHALL process at most two tool calls concurrently and queue the rest in arrival order.
4. Every tool result SHALL be at most 256 KB of serialized JSON; IF a summary is larger THEN ghosts SHALL be truncated by lowest severity first and `truncated: true` SHALL be set.

### Requirement 8: No network

**User Story:** As a privacy-conscious user, I want the server to make no network connections, so that inspecting a file never leaks it.

#### Acceptance Criteria

1. `packages/mcp/src` SHALL NOT use `fetch`, `http`, `https`, `net`, `tls`, `dgram`, `dns`, `undici`, `WebSocket` or `child_process`; `scripts/check-no-network.ts` SHALL include `packages/mcp/src` with these Node module names.
2. A test SHALL run both tools and the resource with `net.Socket.prototype.connect`, `dns.lookup` and `globalThis.fetch` replaced by functions that fail the test when called.
3. The package's runtime dependencies SHALL be limited to `@modelcontextprotocol/sdk`, `zod` and `@palimpsest/core` (plus core's own dependencies).

### Requirement 9: Errors

**User Story:** As an agent, I want machine-readable errors, so that I can recover (for example by choosing another output path).

#### Acceptance Criteria

1. Tool failures SHALL be returned as tool results with `isError: true`, a `text` item "<CODE>: <message>", and `structuredContent: { error: { code, message } }`; they SHALL NOT be thrown as JSON-RPC errors.
2. `code` SHALL be one of `INVALID_INPUT`, `OUTSIDE_ROOT`, `NOT_FOUND`, `NOT_A_FILE`, `TOO_LARGE`, `TIMEOUT`, `UNSUPPORTED_KIND`, `OUT_EXISTS`, `SURVIVORS`, `INTERNAL`.
3. IF core throws (which violates the extractor contract) THEN the server SHALL return `INTERNAL` with the message "Internal error while inspecting; this is a bug." and log the stack to stderr only.

### Requirement 10: Shared core helpers

**User Story:** As a maintainer, I want the MCP server and the Crew bot to share one Node adapter, one ghost-kind catalogue and one redaction rule, so that they cannot drift.

#### Acceptance Criteria

1. `packages/core` SHALL export `nodeAdapters: PlatformAdapters` from the subpath `@palimpsest/core/node`, implementing `decodeImage` and `encodeImage` for PNG and JPEG with pure-JavaScript codecs and no native modules.
2. `packages/core` SHALL export `GHOST_KIND_INFO: Record<GhostKind, { title: string; description: string; typicalSeverity: Severity }>` so the compiler rejects a missing kind.
3. `packages/core` SHALL export `redactGhost(ghost: Ghost): RedactedGhost` that builds its output only from `id`, `kind`, `severity`, `confidence`, the location's `type`, the byte length of byte-range-like locations, the PDF page number and the revision index (following `nested` containers); it SHALL NOT read `title`, `explanation`, `evidence` or location strings (`name`, `path`, `xpath`).
4. A property test SHALL generate ghosts whose `title`, `explanation`, `evidence.summary`, `evidence.fields` values and `raw` contain random marker strings, and fail IF any marker appears in `JSON.stringify(redactGhost(g))`.

### Requirement 11: Kiro Power package

**User Story:** As a Kiro user, I want to install one power that gives my agent Palimpsest, so that attachment scrubbing works without manual setup.

#### Acceptance Criteria

1. The repository SHALL contain `packages/mcp/power/exorcist-power/` with a power manifest, an MCP server configuration, a steering file and a hook definition.
2. The manifest SHALL declare the power's name `exorcist-power`, a display name "Exorcist", a one-sentence description, activation keywords (attachment, upload, screenshot, EXIF, metadata, redact, PDF, DOCX, scrub), the author, the license (MIT) and the version; exact field names SHALL be marked "verify against current Kiro Powers docs".
3. The MCP configuration SHALL launch `palimpsest-mcp` from a pinned npm version (`npx -y @palimpsest/mcp@<exact version>`) with `--root` set to the workspace folder and `--evidence redacted`, and SHALL auto-approve only `inspect_file`.
4. The power SHALL contain no secrets, tokens or network endpoints.
5. A test SHALL validate that the power's MCP configuration parses, names an exact version equal to `packages/mcp/package.json`'s version, and references only tools the server registers.

### Requirement 12: Power steering

**User Story:** As a user, I want my agent to scrub files before it uploads or commits them, so that hidden data does not leak through the agent.

#### Acceptance Criteria

1. The steering file SHALL instruct the agent: before attaching, uploading, posting or committing any PNG, JPEG, HEIC, PDF or DOCX, call `inspect_file`; IF any ghost has severity `revenant`, `wraith` or `shade` THEN tell the user what kinds were found (using redacted summaries), offer `exorcise_file`, and use the `.clean` copy only after the user agrees.
2. The steering SHALL instruct the agent never to paste ghost evidence values into commit messages, issues, PR descriptions or chat, and to describe them by kind ("GPS location present").
3. The steering SHALL instruct the agent to treat `checked: false`, `unchecked` kinds and warnings as "could not check", never as "clean".
4. The steering SHALL state the limits (no steganography, no forensic recovery, no video) in one sentence.

### Requirement 13: Power hook

**User Story:** As a user, I want a nudge when a risky file appears in my workspace, so that I don't forget to check it.

#### Acceptance Criteria

1. The power SHALL include a hook that triggers when a file matching `**/*.{png,jpg,jpeg,heic,pdf,docx}` is created in the workspace, excluding `node_modules/**`, `.git/**` and `**/*.clean.*`.
2. The hook's action SHALL ask the agent to call `inspect_file` on the new file and report the counts by severity in one line, without evidence values.
3. The power SHALL include a second, manually triggered hook "Scrub staged attachments" that asks the agent to inspect every matching file in `git diff --cached --name-only` and summarize.
4. The hook file schema (trigger type names, pattern field, action type) SHALL be marked "verify against current Kiro hooks docs".

### Requirement 14: Dogfooding in this repository

**User Story:** As a Palimpsest developer, I want Kiro to use our own server while we build, so that we test it every day and keep fixtures honest.

#### Acceptance Criteria

1. `.kiro/settings/mcp.json` SHALL register a server `palimpsest` that runs the local source (`npx tsx packages/mcp/src/cli.ts`) with `--root .`, `--read-only` and `--evidence full`, with `autoApprove: ["inspect_file"]`.
2. The repository's `haunted-asset-guard` hook SHALL be able to call `inspect_file` on new files under `fixtures/` to confirm that planted ghosts are synthetic (for example, GPS matches a public landmark list).
3. `docs/KIRO_WRITEUP` SHALL describe the dogfooding loop; this criterion is satisfied by a section heading and at least one recorded example.

### Requirement 15: Packaging

**User Story:** As a power user outside this repo, I want to install the server from npm, so that the power works anywhere.

#### Acceptance Criteria

1. `packages/mcp` SHALL build to `dist/` with `tsc` as ES modules targeting Node 20 or later, with `"bin": { "palimpsest-mcp": "dist/cli.js" }` and a shebang.
2. The published package SHALL include only `dist/`, `README.md`, `LICENSE` and the `power/` folder.
3. `README.md` SHALL document the CLI flags, both tools with example inputs and outputs, the resource, the error codes, and the redaction default.
