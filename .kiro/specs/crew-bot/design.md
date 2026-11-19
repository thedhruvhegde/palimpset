# Design Document

## Overview

`packages/crew` is a Node CLI, `palimpsest-crew scan`, plus thin Kiro Crew definitions that invoke it. The CLI enumerates committed assets through the GitHub REST API, inspects each blob in memory with `packages/core`, decides findings by severity threshold, and reconciles them with existing GitHub issues (and optionally PRs) through a stateless, marker-based idempotency scheme.

The core is written against two ports, `GitHubReader` and `GitHubWriter`, so that the scan logic is pure orchestration over interfaces: tests run against an in-memory fake GitHub, dry run is a writer that records instead of sending, and the Octokit adapter is the only code that talks HTTP.

Design decisions:

- **Plain CLI first, Crew second.** Kiro Crew's job, agent and webhook formats are uncertain (verify against current Kiro Crew docs). Everything that matters runs and is tested without Crew; the Crew files are a few lines that call the CLI.
- **Stateless idempotency.** Scheduled runs are ephemeral. Instead of a state file, each issue carries a marker `<!-- palimpsest-crew:v1 path=… blob=… -->`; GitHub is the state store. Same blob SHA → never re-reported, even after a human closes the issue.
- **Redaction by construction.** Issue and PR bodies are rendered from `RedactedGhost` (built by core `redactGhost`, which cannot read evidence), `GHOST_KIND_INFO`, counts and fixed template text. The renderer never receives a `Ghost`, so it cannot leak a value by mistake.
- **Dry run by default, enforced structurally.** `DryRunWriter` implements `GitHubWriter` by recording planned actions; the Octokit writer is only constructed when dry run is off.
- **Honest about git history.** A PR removes the leak from the tip, not from history. Every issue and PR says so (G6 in spirit).

## Architecture

### Files

```
packages/crew/
  package.json                 bin palimpsest-crew; deps: @palimpsest/core, @octokit/rest, zod, picomatch
  palimpsest-crew.config.json  example config (dry run, shade)
  src/
    cli.ts                     argv (node:util parseArgs) → ScanOptions; exit codes
    config.ts                  CrewConfig zod schema, merge(defaults, file, flags)
    auth.ts                    readToken(env) → Token (opaque, redacting toString/toJSON)
    github/ports.ts            GitHubReader, GitHubWriter interfaces
    github/octokit.ts          Octokit adapters (reader, writer) with throttle + retry
    github/dry-run.ts          DryRunWriter
    github/fake.ts             in-memory FakeGitHub for tests (exported for tests only)
    rate/limiter.ts            read pool, write spacing, budget tracker, retry/backoff
    discover.ts                listTargets(), listAssets() (trees, truncation walk, filters)
    inspect.ts                 inspectBlob() with LFS check, budget, cache by blob SHA
    findings.ts                isFinding(), toFinding()
    render.ts                  renderIssue(), renderPr(), renderComment() from RedactedGhost only
    marker.ts                  formatMarker(), parseMarkers()
    reconcile.ts               plan(): Finding[] × ExistingIssue[] → Action[]
    exorcise-pr.ts             buildExorcismPr(): exorcise, verify, branch/tree/commit/ref/PR
    scan.ts                    runScan(): orchestration → ScanReport
    report.ts                  ScanReport, toHuman(), toJson()
  crew/                        ← verify against current Kiro Crew docs
    palimpsest-scan.job.*      scheduled job: runs the CLI with --json
    palimpsest-steward.agent.* agent: summarizes the JSON report into the Crew workspace
    palimpsest-push.webhook.*  GitHub push → scan --repo --ref --paths
  README.md, LICENSE
```

### Flow

```mermaid
flowchart TB
  CLI[cli.ts scan] --> CFG[config.ts merge + zod]
  CFG --> AUTH[auth.ts GITHUB_TOKEN]
  AUTH --> SCAN[scan.ts runScan]
  SCAN --> DISC[discover.ts]
  DISC -->|GitHubReader: repos, refs, trees| GH[(GitHub API)]
  DISC --> ASSETS[Asset list: repo, path, blob sha, size]
  ASSETS --> INS[inspect.ts]
  INS -->|GitHubReader: blob| GH
  INS -->|core inspect + nodeAdapters| CORE[@palimpsest/core]
  INS --> FIND[findings.ts threshold]
  FIND --> REC[reconcile.ts]
  REC -->|GitHubReader: labeled issues + markers| GH
  REC --> ACT[Action list]
  ACT --> PR[exorcise-pr.ts optional]
  PR -->|core exorcise + verify| CORE
  ACT --> W{dry run?}
  W -- yes --> DRY[DryRunWriter records]
  W -- no --> OCT[Octokit writer, serialized]
  OCT --> GH
  DRY --> REP[report.ts]
  OCT --> REP
  REP --> OUT[stdout: JSON or human]
```

```mermaid
sequenceDiagram
  participant Crew as Kiro Crew job (verify)
  participant CLI as palimpsest-crew
  participant GH as GitHub API
  Crew->>CLI: scan --config … --json (GITHUB_TOKEN in env)
  CLI->>GH: GET /repos/{o}/{r} → default_branch; GET /git/ref/heads/{b}
  CLI->>GH: GET /git/trees/{sha}?recursive=1
  loop each matching blob (≤ readConcurrency)
    CLI->>GH: GET /git/blobs/{sha}
    CLI->>CLI: inspect in memory
  end
  CLI->>GH: GET /issues?labels=palimpsest&state=all (paginate)
  CLI->>CLI: reconcile markers → actions
  CLI->>GH: POST /issues … (serialized, ≥1 s apart)
  CLI-->>Crew: ScanReport JSON
  Crew->>Crew: agent posts counts-only summary
```

## Components and Interfaces

### Options and config

```ts
export const crewConfigSchema: z.ZodType<CrewConfig>;   // .strict()
export interface CrewConfig {
  targets: ({ repo: string } | { org: string; includeRepos?: string[]; excludeRepos?: string[] })[];
  schedule?: string;                    // 5-field cron, validated only
  severityThreshold: Severity;          // default 'shade'
  dryRun: boolean;                      // default true
  openPullRequests: boolean;            // default false
  include: string[]; exclude: string[];
  maxFileBytes: number; maxFilesPerRun: number; maxIssuesPerRepo: number;
  skipForks: boolean; skipArchived: boolean;
  labels: [string, ...string[]];        // first label is the idempotency index
  branchPrefix: string;
  rateLimit: { minRemaining: number; readConcurrency: number; writeSpacingMs: number };
}
export interface ScanOptions extends CrewConfig {
  ref?: string; paths?: string[]; json: boolean; failOnFindings: boolean; apiBaseUrl: string;
}
export function loadOptions(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<ScanOptions | { error: string; issues: z.ZodIssue[] }>;
```

`repo` is validated as `/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/`; org as the owner half.

### Auth

```ts
export interface Token { readonly value: string; toString(): '[redacted]'; toJSON(): '[redacted]' }
export function readToken(env: NodeJS.ProcessEnv): Token | null;  // GITHUB_TOKEN ?? GH_TOKEN
```

The token is passed only to the Octokit constructor (`auth: token.value`). Octokit's request errors include request options; `octokit.ts` maps every error to a `GitHubError { status, route, message }` without headers before it leaves the adapter.

### GitHub ports

```ts
export interface RepoInfo { owner: string; name: string; defaultBranch: string; fork: boolean; archived: boolean; disabled: boolean }
export interface TreeEntry { path: string; mode: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number }
export interface ExistingIssue { number: number; state: 'open' | 'closed'; closedAt: string | null; body: string }

export interface GitHubReader {
  listOrgRepos(org: string): AsyncIterable<RepoInfo>;
  getRepo(owner: string, name: string): Promise<RepoInfo>;
  resolveRef(owner: string, name: string, ref: string): Promise<string>;            // → commit sha
  getTree(owner: string, name: string, treeSha: string, recursive: boolean): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  getCommitTreeSha(owner: string, name: string, commitSha: string): Promise<string>;
  getBlob(owner: string, name: string, blobSha: string): Promise<Uint8Array>;
  listLabeledIssues(owner: string, name: string, label: string): AsyncIterable<ExistingIssue>;  // state=all, excludes PRs
  refExists(owner: string, name: string, branch: string): Promise<boolean>;
}

export interface GitHubWriter {
  ensureLabels(owner: string, name: string, labels: readonly string[]): Promise<void>;
  createIssue(owner: string, name: string, i: { title: string; body: string; labels: string[] }): Promise<number>;
  updateIssueBody(owner: string, name: string, number: number, body: string): Promise<void>;
  comment(owner: string, name: string, number: number, body: string): Promise<void>;
  createBlob(owner: string, name: string, bytes: Uint8Array): Promise<string>;
  createTree(owner: string, name: string, baseTree: string, entry: { path: string; mode: string; sha: string }): Promise<string>;
  createCommit(owner: string, name: string, c: { message: string; tree: string; parents: [string] }): Promise<string>;
  createRef(owner: string, name: string, branch: string, sha: string): Promise<void>;
  createPull(owner: string, name: string, p: { title: string; body: string; head: string; base: string }): Promise<number>;
}

export function createOctokitPorts(token: Token, baseUrl: string, limiter: Limiter): { reader: GitHubReader; writer: GitHubWriter };
export class DryRunWriter implements GitHubWriter { readonly planned: PlannedAction[] }
```

REST routes used: `GET /orgs/{org}/repos`, `GET /repos/{o}/{r}`, `GET /repos/{o}/{r}/commits/{ref}` (resolve to SHA), `GET /repos/{o}/{r}/git/trees/{sha}` (`recursive=1`), `GET /repos/{o}/{r}/git/blobs/{sha}` (base64, up to 100 MB), `GET /repos/{o}/{r}/issues?labels=…&state=all&per_page=100`, `GET /repos/{o}/{r}/git/ref/heads/{branch}`, and for writes `POST /repos/{o}/{r}/labels`, `POST …/issues`, `PATCH …/issues/{n}`, `POST …/issues/{n}/comments`, `POST …/git/blobs`, `POST …/git/trees`, `POST …/git/commits`, `POST …/git/refs`, `POST …/pulls`. `DryRunWriter` returns synthetic numbers (`-1`, `-2`, …) so downstream planning (for example "Closes #n") still renders.

### Rate limiting (`rate/limiter.ts`)

```ts
export interface Limiter {
  read<T>(fn: () => Promise<Resp<T>>): Promise<T>;     // pool of readConcurrency
  write<T>(fn: () => Promise<Resp<T>>): Promise<T>;    // single queue, ≥ writeSpacingMs apart
  readonly exhausted: boolean;                         // remaining < minRemaining
  readonly resetAt: Date | null;
}
export interface Resp<T> { data: T; headers: Record<string, string | undefined>; status: number }
export function createLimiter(cfg: CrewConfig['rateLimit'], clock: Clock): Limiter;
export function backoffMs(attempt: 1 | 2 | 3, rand: () => number): number;  // 1000·2^(a−1) · (0.8 + 0.4·rand)
```

Every response updates `remaining` / `resetAt` from `x-ratelimit-remaining` / `x-ratelimit-reset`. A 403/429 with `retry-after`, or a 403 whose message mentions secondary rate limit, waits `retry-after` seconds (default 60) and retries up to 3 times; 5xx and network errors use `backoffMs`. `Clock` is injectable for tests. `runScan` checks `limiter.exhausted` before starting each asset and each write.

### Discovery (`discover.ts`)

```ts
export interface Asset { owner: string; repo: string; commit: string; path: string; blob: string; size: number }
export interface Skipped { owner: string; repo: string; path: string; reason: 'too-large' | 'lfs' | 'unknown-kind' | 'submodule' | 'symlink' | 'excluded' | 'limit' | 'error'; detail?: string }
export function listTargets(reader: GitHubReader, opts: ScanOptions): AsyncIterable<RepoInfo>;
export function listAssets(reader: GitHubReader, repo: RepoInfo, opts: ScanOptions): Promise<{ commit: string; assets: Asset[]; skipped: Skipped[] }>;
export function matches(path: string, include: readonly string[], exclude: readonly string[]): boolean;  // picomatch, dot: true, nocase: true
```

Truncated recursive trees fall back to a breadth-first walk with `recursive: false` on each `tree` entry. With `--paths`, entries are looked up by path in the tree (no full listing filter beyond include/exclude).

### Inspection (`inspect.ts`)

```ts
export type BlobResult =
  | { status: 'inspected'; inspection: Inspection }
  | { status: 'skipped'; reason: 'lfs' | 'unknown-kind' | 'timeout' | 'error'; detail?: string };
export function isLfsPointer(bytes: Uint8Array): boolean;   // first 200 bytes start with "version https://git-lfs.github.com/spec/v1"
export function inspectBlob(bytes: Uint8Array, cache: Map<string, BlobResult>, blobSha: string): Promise<BlobResult>;
```

Calls `inspect(bytes, { signal: AbortSignal.timeout(budget), adapters: nodeAdapters })` with `budget = max(5000, 2000 × MB)`. A timeout with a partial inspection is kept as `inspected` with the warning, never treated as clean.

### Findings (`findings.ts`)

```ts
export interface Finding {
  asset: Asset;
  kind: FileKind;
  counts: Record<Severity, number>;
  highest: Severity;
  ghosts: RedactedGhost[];             // all ghosts, sorted by SEVERITY_ORDER
  unchecked: GhostKind[];
  warnings: number;                    // count only; warning messages may echo file content
}
export function atOrAbove(s: Severity, t: Severity): boolean;   // SEVERITY_ORDER.indexOf(s) <= indexOf(t)
export function isFinding(insp: Inspection, threshold: Severity): boolean;  // some ghost atOrAbove && confidence ≥ 0.6
export function toFinding(asset: Asset, insp: Inspection): Finding;         // uses redactGhost, redactedCounts
```

`toFinding` is the only place a `Ghost` is touched after inspection; it drops everything except `redactGhost(g)`.

### Markers and reconciliation

```ts
export interface Marker { path: string; blob: string }
export function formatMarker(m: Marker): string;              // <!-- palimpsest-crew:v1 path=<encodeURIComponent> blob=<40 hex> -->
export function parseMarkers(body: string): Marker[];         // tolerant, ignores malformed

export type Action =
  | { type: 'open-issue'; finding: Finding; references?: number }
  | { type: 'update-issue'; number: number; finding: Finding; previousBlob: string }
  | { type: 'comment-resolved'; number: number; path: string; commit: string }
  | { type: 'open-pr'; finding: Finding; issue: number }
  | { type: 'defer'; finding: Finding };
export function plan(findings: readonly Finding[], scannedPaths: ReadonlySet<string>,
  existing: readonly ExistingIssue[], opts: Pick<ScanOptions, 'maxIssuesPerRepo' | 'openPullRequests'>, commit: string): Action[];
```

`plan` rules (Requirement 8): index existing markers by path; same path and blob in any issue → no action; open issue with same path, different blob → `update-issue` (+ comment rendered in `update`); only closed issues with that path → `open-issue` with `references` = most recently closed; open issue whose path was scanned and is no longer a finding (or whose path is absent from the tree) → `comment-resolved`, once (the comment carries its own marker `<!-- palimpsest-crew:v1 resolved commit=<sha> -->`, and a resolved comment for the same commit is not repeated; detecting it requires listing that issue's comments, done only for candidate issues). New issues beyond `maxIssuesPerRepo` → `defer`, ordered by highest severity then path. `plan` is pure.

### Rendering (`render.ts`)

```ts
export interface RenderedIssue { title: string; body: string }
export function renderIssue(f: Finding, ctx: { references?: number; exorcismNote?: string }): RenderedIssue;
export function renderUpdateComment(previousBlob: string, f: Finding): string;
export function renderResolvedComment(commit: string): string;
export function renderPr(f: Finding, banished: Exorcism['banished'], issue: number): RenderedIssue;
```

Inputs are `Finding` (redacted by construction), `GHOST_KIND_INFO`, numbers and fixed strings; paths are inserted inside backticks with backticks escaped. Issue body layout:

1. "Palimpsest found hidden data in `<path>` (<KIND>, <size>) at blob `<blob7>` on commit `<commit7>`."
2. Counts table: severity | count (all four rows).
3. Ghost list: "- **<severity>** · <RedactedGhost.summary> · <where>" (no values).
4. "What this means": one line per distinct kind from `GHOST_KIND_INFO[kind].description`.
5. "Could not check": `unchecked` kinds, if any.
6. "How to fix": drop the file into the Palimpsest web app (runs locally) or run `npx palimpsest-mcp` / the CLI; or merge the bot's PR if one is linked.
7. History warning (Requirement 7.4).
8. Marker.

### Exorcism PR (`exorcise-pr.ts`)

```ts
export type PrOutcome =
  | { status: 'opened'; number: number; branch: string }
  | { status: 'skipped'; reason: 'incomplete' | 'kind-changed' | 'branch-exists' | 'dry-run' };
export function branchName(prefix: string, path: string, blob: string): string;   // prefix + sha256(path).slice(0,8) + '-' + blob.slice(0,7)
export function buildExorcismPr(reader: GitHubReader, writer: GitHubWriter, f: Finding, bytes: Uint8Array,
  commit: string, defaultBranch: string, threshold: Severity, issue: number): Promise<PrOutcome>;
```

Steps: `exorcise(bytes, { adapters: nodeAdapters })` → if any `verification.ghosts` at or above threshold → `incomplete`; if `verification.kind !== f.kind` → `kind-changed`; if `refExists` → `branch-exists`; else `createBlob` → `createTree(baseTree = commit's tree, { path, mode: '100644', sha })` → `createCommit(parents: [commit])` → `createRef` → `createPull`. When PRs are enabled, `runScan` keeps the bytes of finding blobs in memory until that repo's actions are executed, then drops them; bytes are never written to disk.

### Orchestration and report

```ts
export interface ScanReport {
  tool: { name: 'palimpsest-crew'; version: string; coreVersion: string };
  startedAt: string; finishedAt: string; dryRun: boolean; threshold: Severity;
  repos: { owner: string; repo: string; commit: string | null; scanned: number; error?: string }[];
  findings: (Finding & { issue?: number; pr?: PrOutcome })[];
  skipped: Skipped[];
  actions: { type: Action['type']; repo: string; path?: string; number?: number; title?: string; body?: string }[];
  stoppedEarly?: { reason: 'rate-limit' | 'file-limit'; resetAt?: string };
}
export function runScan(opts: ScanOptions, ports: { reader: GitHubReader; writer: GitHubWriter }, limiter: Limiter): Promise<ScanReport>;
export function toHuman(r: ScanReport): string;
```

Per repo: `listAssets` → for each asset (bounded by `readConcurrency` and `maxFilesPerRun`) `getBlob` → `inspectBlob` → `toFinding` if `isFinding`. Then `ensureLabels` (only if there is a write action), `listLabeledIssues(labels[0])` → `plan` → execute actions in order with the writer; `open-pr` runs after its issue exists so the PR can say "Closes #n". Errors are caught per asset and per repo into `skipped` / `repos[].error`.

### Kiro Crew definitions (verify against current Kiro Crew docs)

The content is fixed; file names, extensions and keys follow whatever the current Kiro Crew docs specify.

- **Scheduled job `palimpsest-scan`:** schedule from config (example `17 6 * * *`, daily 06:17 UTC); command `npx -y @palimpsest/crew@<exact version> scan --config palimpsest-crew.config.json --json`; environment `GITHUB_TOKEN` from the Crew secret store; output (stdout) handed to the agent below.
- **Agent `palimpsest-steward`:** instructions: "Run the scan job's command or read its latest JSON report. Post a summary to the workspace: repos scanned, files scanned, findings by highest severity, issues opened or updated, PRs opened, skipped by reason, and whether the run stopped early. Never quote paths of findings outside the repository's own issue tracker if the repository is private. Never include evidence values; the report contains none." Tools: shell (to run the CLI) only.
- **Webhook `palimpsest-push`:** GitHub `push` events on the default branch; maps `repository.full_name`, `after`, and the union of `commits[].added` and `commits[].modified` filtered by `include` to `scan --repo … --ref … --paths …`.

### Public repository

The monorepo is the primary home. If it is not public at submission time, `scripts/mirror-crew.ts` assembles a standalone repo: `packages/crew` sources, a pinned `@palimpsest/core` dependency from npm, `README.md`, `LICENSE` (MIT) and the `crew/` definitions, to be pushed to `palimpsest-crew` on the same GitHub account. The checklist in `docs/COMMIT_PLAN` (submission section) records the visibility check.

## Data Models

### Proposed change to types.ts

None beyond `RedactedGhost`, which is proposed in the `mcp-and-power` design and used here unchanged. `Finding`, `Asset`, `Skipped`, `Action`, `ScanReport` and the GitHub port types are Crew-internal and built from `Inspection`, `Severity`, `FileKind`, `GhostKind` and `RedactedGhost`.

### Example config (`palimpsest-crew.config.json`)

```json
{
  "targets": [{ "org": "example-org", "excludeRepos": ["*-archive"] }],
  "schedule": "17 6 * * *",
  "severityThreshold": "shade",
  "dryRun": true,
  "openPullRequests": false,
  "maxIssuesPerRepo": 10,
  "rateLimit": { "minRemaining": 200, "readConcurrency": 4, "writeSpacingMs": 1000 }
}
```

### Marker grammar

```
marker   = "<!-- palimpsest-crew:v1 " "path=" pct-path " blob=" 40HEXDIG " -->"
resolved = "<!-- palimpsest-crew:v1 resolved commit=" 40HEXDIG " -->"
pct-path = encodeURIComponent(path)
```

## Error Handling

| Condition | Behaviour |
|---|---|
| Invalid flags or config, unknown keys, secret-looking keys | zod issues to stderr, exit 2 |
| No token | exit 2, fixed message |
| 401 Bad credentials | fatal, exit 1, "GitHub rejected the token (401)." |
| 403 permission on a write (for example Issues disabled or missing scope) | repo-level error recorded, no further writes to that repo, run continues |
| 404 repo or ref | repo-level error recorded, run continues |
| Issues disabled on repo (`has_issues: false`) | findings reported, actions skipped with reason "issues disabled" |
| Rate limit near exhaustion | stop starting work, `stoppedEarly: rate-limit` with reset time, exit 0 |
| Secondary limit / 429 / 5xx / network | retry per Requirement 11.4, 11.5; after 3 failures, record and continue |
| Blob too large, LFS, symlink, submodule, unknown kind | `skipped` with reason, never "clean" |
| Core inspect timeout | partial inspection kept with warning count |
| Core throws (contract violation) | asset `skipped: error`, stack to stderr without file bytes |
| Exorcism incomplete or kind changes | no PR; note in issue body |

## Correctness Properties

1. **P1 Redaction.** For any inspection whose ghost string fields (`title`, `explanation`, `evidence.summary`, `evidence.fields` values, `raw` strings, `zip-entry.path`, `xpath`, `chunk.name`) contain random marker strings, no marker appears in `renderIssue`, `renderPr`, comments or `toJson(report)`.
2. **P2 Threshold.** `isFinding(insp, t)` is true iff some ghost has `atOrAbove(severity, t)` and `confidence ≥ 0.6`; `atOrAbove` is a total order consistent with `SEVERITY_ORDER`.
3. **P3 Marker round trip.** For any path (Unicode, spaces, `-->`, backticks) and 40-hex blob, `parseMarkers(formatMarker(m))` returns `[m]`, and a body containing arbitrary text plus a marker still parses.
4. **P4 Plan idempotency.** Applying `plan`'s actions to a fake GitHub and re-running `plan` on the same findings yields no write actions.
5. **P5 No duplicate per blob.** For any existing issue set, `plan` never emits `open-issue` or `update-issue` for a (path, blob) pair already present in a marker.
6. **P6 Issue cap.** `plan` emits at most `maxIssuesPerRepo` `open-issue` actions per repo, and deferred findings are never higher severity than an opened one.
7. **P7 Dry run is read-only.** With `DryRunWriter`, a full `runScan` against a fake GitHub that throws on any write completes, and `report.actions` equals the actions the real writer would perform.
8. **P8 Token secrecy.** With a marker token, no stdout, stderr, report, rendered body or thrown error message contains it.
9. **P9 Write spacing.** Under a fake clock, consecutive write starts are at least `writeSpacingMs` apart and reads never exceed `readConcurrency` in flight.
10. **P10 Host allow-list.** All HTTP requests in an Octokit-adapter test go to the configured base URL host.

## Testing Strategy

- **Unit (vitest):** `config.ts` (defaults, strictness, flag override order), `auth.ts`, `matches`, `isLfsPointer`, `atOrAbove` / `isFinding` (P2), `formatMarker` / `parseMarkers` (P3, `fast-check` paths), `plan` table tests for each rule in Requirement 8 plus P5 and P6, `branchName`, `backoffMs`, limiter under a fake clock (P9), `render.ts` snapshots and P1 with `fast-check` ghost arbitraries built from `types.ts` shapes.
- **Fake-GitHub integration:** `FakeGitHub` implements both ports over in-memory repos, trees (with a forced `truncated: true` case), blobs (Haunted Gallery fixtures, an LFS pointer, an oversize entry, a submodule, a symlink), labeled issues and refs. Scenarios: first run opens issues; second run makes zero writes (P4); file changed → update + comment; issue closed then new blob → new issue referencing it; file cleaned → one resolved comment; PRs on, with a fixture whose exorcism verifies clean and one that changes kind; dry run against a throwing writer (P7); token marker (P8).
- **Octokit adapter:** Octokit constructed with a stub `request.fetch` that records URLs and returns canned responses for each route, including 403 secondary limit with `retry-after`, 429, 502 and pagination `link` headers; asserts retries, header-free error mapping and P10.
- **CLI:** spawn `palimpsest-crew scan` with `--json` against the fake (injected through a test-only `PALIMPSEST_CREW_FAKE` module path that is ignored unless `NODE_ENV=test`), check exit codes 0, 2, 3 and that stdout is a single JSON document.
- **Manual end to end:** a sandbox public repository on the team account seeded with Haunted Gallery fixtures; run once in dry run, then for real with PRs on; record the issue and PR links in `docs/KIRO_WRITEUP` for judges.
