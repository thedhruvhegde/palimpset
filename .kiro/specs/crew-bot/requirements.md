# Requirements Document

## Introduction

This spec covers `packages/crew`, the Palimpsest Crew bot: a scheduled job that scans the committed images, PDFs and DOCX files of a GitHub organization or repository with `packages/core` in Node, and for each file holding ghosts at severity `shade` or worse (configurable) opens a GitHub issue with a **redacted** summary ("GPS location present", never the coordinates) and, optionally, a pull request replacing the file with its exorcised version.

Kiro Crew is AWS's open-source multi-agent workspace on the Kiro CLI, with scheduled jobs and webhooks. Its job and agent definition formats are not pinned down here, so the design keeps the bot's logic in a plain Node CLI, `palimpsest-crew scan --repo owner/name`, that any runner can call. The Crew job and agent definitions that invoke it are marked **verify against current Kiro Crew docs**.

The bot uses only shapes from `packages/core/src/types.ts` (`Inspection`, `Ghost`, `Exorcism`, `Severity`, `SEVERITY_ORDER`, `FileKind`, `GhostKind`) and the shared core helpers introduced by the `mcp-and-power` spec: `nodeAdapters` (`@palimpsest/core/node`), `GHOST_KIND_INFO`, and `redactGhost` returning the proposed `RedactedGhost` type.

**Hackathon note:** the Best Kiro Crew App bonus requires the bot to live in a public repository on the same GitHub account as the submission. Either the Palimpsest monorepo is public, or `packages/crew` is mirrored to a public repository (for example `palimpsest-crew`) under the same account; Requirement 14 covers this.

Severity comparison: severity `a` is "at or above" threshold `t` when `SEVERITY_ORDER.indexOf(a) <= SEVERITY_ORDER.indexOf(t)` (`revenant` is highest).

## Requirements

### Requirement 1: Command-line interface

**User Story:** As a maintainer, I want a single CLI command that scans a repo or an org, so that the same logic runs locally, in CI and as a Crew job.

#### Acceptance Criteria

1. The package SHALL provide a bin `palimpsest-crew` with the subcommand `scan`.
2. `scan` SHALL accept exactly one of `--repo <owner/name>` or `--org <org>`, plus `--config <path>`, `--threshold <severity>`, `--dry-run` / `--no-dry-run`, `--open-prs`, `--ref <branch|sha>`, `--paths <comma-separated repo paths>`, `--max-files <n>`, `--json` and `--fail-on-findings`.
3. Command-line flags SHALL override config file values, which SHALL override defaults.
4. IF arguments or config are invalid THEN the CLI SHALL print the zod issues to stderr and exit with code 2.
5. WHEN `--paths` is given THEN only those paths SHALL be scanned (used by push webhooks); paths outside the include globs SHALL be skipped and reported.
6. Exit codes SHALL be: 0 when the run completed (with or without findings, unless `--fail-on-findings`), 3 when `--fail-on-findings` is set and at least one finding met the threshold, 1 on a fatal runtime error, 2 on invalid input.

### Requirement 2: Configuration

**User Story:** As a maintainer, I want a small validated config file, so that the scheduled job is reproducible and safe by default.

#### Acceptance Criteria

1. The config SHALL be a JSON file (`palimpsest-crew.config.json` by default) validated with zod, with fields: `targets` (array of `{ repo }` or `{ org, includeRepos?, excludeRepos? }`), `schedule` (5-field cron string, validated but used only by the Crew job definition), `severityThreshold` (default `shade`), `dryRun` (default `true`), `openPullRequests` (default `false`), `include` (default `["**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.heic", "**/*.pdf", "**/*.docx"]`), `exclude` (default `["**/node_modules/**", "**/*.clean.*"]`), `maxFileBytes` (default 26,214,400; maximum 104,857,600), `maxFilesPerRun` (default 500), `maxIssuesPerRepo` (default 10), `skipForks` (default `true`), `skipArchived` (default `true`), `labels` (default `["palimpsest", "haunted-file"]`), `branchPrefix` (default `palimpsest/exorcise-`), and `rateLimit` (`{ minRemaining: 200, readConcurrency: 4, writeSpacingMs: 1000 }`).
2. The config schema SHALL be strict; IF it contains an unknown key, including any key named `token`, `auth` or `password`, THEN validation SHALL fail.
3. WHEN no `--config` is given and no default file exists THEN the CLI SHALL run with defaults and the target from `--repo` or `--org`.

### Requirement 3: Authentication

**User Story:** As a maintainer, I want the bot to use a token supplied by its runtime, so that no secret is stored in the repo or config.

#### Acceptance Criteria

1. The bot SHALL read the GitHub token from the `GITHUB_TOKEN` environment variable, falling back to `GH_TOKEN`; IF neither is set THEN it SHALL exit with code 2 and the message "No GitHub token in GITHUB_TOKEN or GH_TOKEN."
2. The bot SHALL never print, log, or include the token in reports, issue bodies, PR bodies, error messages or thrown errors; a test SHALL run a full fake scan with a marker token and assert the marker never appears in captured output.
3. The README SHALL list the minimum fine-grained token permissions: Metadata read, Contents read (Contents write only when PRs are enabled), Issues write; Pull requests write only when PRs are enabled.
4. The bot SHALL support a GitHub Enterprise base URL through `GITHUB_API_URL` (default `https://api.github.com`).

### Requirement 4: Discovering files

**User Story:** As an org owner, I want every committed asset on the default branch considered, so that nothing slips through.

#### Acceptance Criteria

1. WHEN the target is an org THEN the bot SHALL list the org's repositories with pagination and skip forks, archived and disabled repositories according to config, then apply `includeRepos` / `excludeRepos` globs.
2. For each repository the bot SHALL resolve `--ref` or the default branch to a commit SHA, then read the recursive git tree for that commit.
3. IF the tree response is truncated THEN the bot SHALL walk subtrees non-recursively until all entries are listed.
4. The bot SHALL keep tree entries of type `blob` whose path matches `include` and not `exclude`, and SHALL skip entries larger than `maxFileBytes`, reporting them as "skipped: too large" (never as clean).
5. The bot SHALL stop adding files when `maxFilesPerRun` is reached across all repositories and report "file limit reached; <n> files not scanned".
6. Submodule entries (`commit` type) and symlinks (mode `120000`) SHALL be skipped and reported.

### Requirement 5: Fetching and inspecting

**User Story:** As a maintainer, I want each file inspected with the same engine as the web app, so that findings match what a user would see.

#### Acceptance Criteria

1. The bot SHALL fetch each blob's bytes with the git blobs API by blob SHA and decode the base64 content in memory, without writing it to disk.
2. IF the blob content is a Git LFS pointer (starts with `version https://git-lfs.github.com/spec/v1`) THEN the bot SHALL report "not checked: Git LFS object" and SHALL NOT inspect it.
3. The bot SHALL call core `inspect` with `nodeAdapters` and an `AbortSignal` with a budget of `max(5000, 2000 × size_in_MB)` ms.
4. The file kind SHALL be the `Inspection.kind` from magic bytes; IF it is `unknown` THEN the file SHALL be reported as "not checked: unknown kind".
5. Inspection results SHALL be cached in memory per blob SHA within a run, so that identical blobs in several repositories are inspected once.
6. The bot SHALL make no network requests other than to the configured GitHub API base URL; a test SHALL fail on any other host.

### Requirement 6: Threshold and findings

**User Story:** As a maintainer, I want only meaningful leaks reported, so that the issues are worth reading.

#### Acceptance Criteria

1. A file SHALL be a finding WHEN at least one of its ghosts has severity at or above `severityThreshold` and `confidence` at least 0.6.
2. Ghosts below the threshold or below 0.6 confidence SHALL be included in the finding's counts but SHALL NOT make a file a finding on their own.
3. The run report SHALL list each finding with repository, path, blob SHA, kind, counts by severity, highest severity, and the redacted ghosts.

### Requirement 7: Redacted issue content

**User Story:** As someone whose photo is in a public repo, I want the bot's issue to say what kind of data leaks without repeating it, so that the issue itself doesn't make the leak worse.

#### Acceptance Criteria

1. The issue title SHALL be "Hidden data in <path>: <highest severity> (<n> ghosts)".
2. The issue body SHALL be built only from: the repository, path, blob SHA, commit SHA, file kind, file size, counts by severity, `RedactedGhost` entries (`summary`, `where`, `severity`), `GHOST_KIND_INFO` titles and descriptions, `Inspection.unchecked` kinds, and fixed template text.
3. The issue body SHALL NOT contain any `Ghost.title`, `Ghost.explanation`, `evidence.summary`, `evidence.fields` value, `evidence.raw`, `evidence.preview`, `zip-entry` path, `xpath` or chunk name.
4. The issue body SHALL state that removing the file in a new commit does not remove it from git history, and that the exposed data should be treated as already public if the repository is or was public.
5. The issue body SHALL end with a machine-readable marker `<!-- palimpsest-crew:v1 path=<percent-encoded path> blob=<blob sha> -->`.
6. A property test SHALL generate inspections whose ghost string fields contain random markers and fail IF any marker appears in the rendered title or body.

### Requirement 8: Idempotency

**User Story:** As a maintainer, I want the scheduled job not to spam duplicate issues, so that the bot stays welcome.

#### Acceptance Criteria

1. Before opening issues in a repository, the bot SHALL list all issues (open and closed) carrying the first configured label, with pagination, and parse their markers.
2. IF an issue with the same path and blob SHA exists (open or closed) THEN the bot SHALL NOT open another issue or comment for that file.
3. IF an open issue exists for the same path with a different blob SHA THEN the bot SHALL update that issue's body to the new findings and add one comment "The file changed (blob <old7> → <new7>) and is still haunted."
4. IF only closed issues exist for the same path with a different blob SHA THEN the bot SHALL open a new issue that references the most recent closed one.
5. WHEN a previously reported path no longer has a finding (file removed or cleaned) THEN the bot SHALL add one comment "No longer haunted at <commit7>." to the open issue and SHALL NOT close it.
6. Running the same scan twice against an unchanged repository SHALL produce zero write requests on the second run.
7. The bot SHALL open at most `maxIssuesPerRepo` new issues per repository per run and report the remainder as "deferred".

### Requirement 9: Optional exorcism pull requests

**User Story:** As a maintainer, I want an optional ready-made PR with the cleaned file, so that fixing the leak is one click.

#### Acceptance Criteria

1. WHEN `openPullRequests` is true and dry run is off THEN for each finding the bot SHALL call core `exorcise` on the blob bytes with default options.
2. IF the `verification` inspection still contains a ghost at or above the threshold THEN the bot SHALL NOT open a PR and SHALL note "automatic exorcism incomplete" in the issue.
3. The bot SHALL create the branch `<branchPrefix><first 8 hex of sha256(path)>-<blob7>` from the scanned commit; IF the branch already exists THEN the bot SHALL skip PR creation for that file.
4. The commit SHALL replace only that file's content (git blob → tree with `base_tree` → commit with the scanned commit as parent → ref), with message "fix(assets): exorcise hidden data from <path>".
5. The PR SHALL target the default branch, use a redacted body following Requirement 7.2 and 7.3, list the banished counts by kind, repeat the git-history warning, and include "Closes #<issue>".
6. IF `verification.kind` differs from the input's `Inspection.kind` (for example HEIC re-encoded to JPEG) THEN the bot SHALL NOT open a PR and the issue SHALL say "Automatic exorcism changes the file type; fix manually."

### Requirement 10: Dry run

**User Story:** As a maintainer trying the bot for the first time, I want to see exactly what it would do without it doing anything, so that I can trust it.

#### Acceptance Criteria

1. Dry run SHALL be the default.
2. WHILE in dry run the bot SHALL make no write requests (POST, PATCH, PUT, DELETE) to GitHub; this SHALL be enforced by the writer implementation, not by checks at call sites.
3. In dry run the report SHALL list every planned action (`open-issue`, `update-issue`, `comment`, `open-pr`) with the rendered title and body.
4. A test SHALL run a dry scan against a fake GitHub that fails on any write method.

### Requirement 11: Rate limiting and resilience

**User Story:** As an org owner, I want the bot to respect GitHub's limits, so that it never gets the token blocked.

#### Acceptance Criteria

1. Read requests SHALL run with at most `rateLimit.readConcurrency` in flight.
2. Write requests SHALL be serialized with at least `rateLimit.writeSpacingMs` between them.
3. The bot SHALL track `x-ratelimit-remaining` and `x-ratelimit-reset`; WHEN remaining falls below `rateLimit.minRemaining` THEN it SHALL stop starting new work, finish in-flight work, and report "stopped early: rate limit" with the reset time.
4. WHEN GitHub responds 403 or 429 with `retry-after` or a secondary-rate-limit message THEN the bot SHALL wait the indicated time (default 60 s) and retry up to 3 times.
5. WHEN a request fails with 5xx or a network error THEN the bot SHALL retry up to 3 times with exponential backoff (1 s, 2 s, 4 s, ±20% jitter).
6. A failure for one file or repository SHALL be reported and SHALL NOT abort the rest of the run.

### Requirement 12: Reporting

**User Story:** As a Crew operator, I want a clear summary of each run, so that the Crew agent can post or act on it.

#### Acceptance Criteria

1. WHEN `--json` is given THEN the CLI SHALL print exactly one JSON `ScanReport` to stdout and all logs to stderr.
2. Otherwise the CLI SHALL print a human summary: repositories scanned, files scanned, findings by highest severity, issues opened/updated, PRs opened, skipped files by reason, and planned actions in dry run.
3. The report SHALL contain only redacted ghost data, under the same rules as Requirement 7.3.
4. The report SHALL include `startedAt`, `finishedAt`, the tool version and the core version.

### Requirement 13: Kiro Crew job and agent

**User Story:** As a hackathon judge, I want to see the bot running as a Kiro Crew app on a schedule and on pushes, so that it qualifies as a Crew app.

#### Acceptance Criteria

1. `packages/crew/crew/` SHALL contain a scheduled job definition that runs `npx palimpsest-crew scan --config palimpsest-crew.config.json --json` on the config's `schedule`; the file format SHALL be marked "verify against current Kiro Crew docs".
2. `packages/crew/crew/` SHALL contain an agent definition whose instructions are: run the scan, read the JSON report, and post a short run summary (counts only, no evidence values) to the Crew workspace; the format SHALL be marked "verify against current Kiro Crew docs".
3. `packages/crew/crew/` SHALL contain a webhook definition for GitHub `push` events on the default branch that runs `scan --repo <repo> --ref <after> --paths <added and modified files matching include>`; IF Crew's webhook payload access differs THEN the definition SHALL be adapted and this criterion re-verified.
4. The GitHub token SHALL be provided to the job through the Crew runtime's secret or environment mechanism as `GITHUB_TOKEN`; the definitions SHALL NOT contain a token.
5. The README SHALL describe running the same CLI without Crew (cron, GitHub Actions) so that the bot is useful if Crew's format changes.

### Requirement 14: Public repository for the Crew bonus

**User Story:** As the submitting team, I want the bot in a public repo on our account, so that it qualifies for Best Kiro Crew App.

#### Acceptance Criteria

1. Before submission, the repository containing `packages/crew` (the monorepo, or a public mirror named `palimpsest-crew` on the same GitHub account) SHALL be public, with an MIT `LICENSE` and a README describing setup, permissions, config and the Crew definitions.
2. The submission checklist in `docs/` SHALL include a line verifying the repository's visibility and owner match the submission account.
3. IF a mirror is used THEN a script SHALL produce it from `packages/crew` plus the shared core build, and the mirror's README SHALL link back to the monorepo.

### Requirement 15: Safety and privacy

**User Story:** As an org owner, I want the bot to handle our files carefully, so that scanning never becomes a leak itself.

#### Acceptance Criteria

1. The bot SHALL keep file bytes only in memory and SHALL NOT write them to disk, logs or reports.
2. The bot SHALL send no telemetry and contact no host other than the GitHub API base URL.
3. The bot SHALL operate only on targets named in config or flags; it SHALL NOT follow links to other repositories (for example submodules).
4. Issues SHALL be opened only in the repository that contains the file.
