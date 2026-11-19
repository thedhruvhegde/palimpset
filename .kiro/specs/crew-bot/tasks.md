# Implementation Plan

Prerequisites: core `inspect` / `exorcise` (core spec) and, from the `mcp-and-power` spec, task 1 (`RedactedGhost` in `types.ts`, `GHOST_KIND_INFO`, `redactGhost`, `redactedCounts`, `@palimpsest/core/node`). Every task ends with `npm run typecheck && npm test -w packages/crew` green.

- [ ] 1. Scaffold the package
  - Create `packages/crew/package.json` (bin `palimpsest-crew`, exact versions of `@octokit/rest`, `zod`, `picomatch`; workspace `@palimpsest/core`), `tsconfig.json`, `src/cli.ts` with a `scan` subcommand stub that prints usage, `LICENSE` (MIT).
  - _Requirements: 1.1, 14.1_

- [ ] 2. Configuration and auth
  - [ ] 2.1 Implement `config.ts`: strict `crewConfigSchema` with every default, repo/org validation, cron validation, merge order defaults → file → flags; tests for unknown and secret-looking keys.
    - _Requirements: 2.1, 2.2, 2.3, 1.3_
  - [ ] 2.2 Implement CLI parsing in `cli.ts` (`--repo` xor `--org`, all flags, zod issues to stderr, exit 2) and `auth.ts` (`GITHUB_TOKEN` ?? `GH_TOKEN`, redacting `Token`, `GITHUB_API_URL`).
    - _Requirements: 1.2, 1.4, 3.1, 3.4_

- [ ] 3. Pure decision logic
  - [ ] 3.1 Implement `findings.ts` (`atOrAbove`, `isFinding` with confidence ≥ 0.6, `toFinding` via `redactGhost`) with P2.
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ] 3.2 Implement `marker.ts` (`formatMarker`, `parseMarkers`, resolved-comment marker) with P3.
    - _Requirements: 7.5, 8.1_
  - [ ] 3.3 Implement `render.ts` (issue title/body layout, update and resolved comments, PR body, backtick escaping, history warning) with snapshots and the P1 marker-string property test.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 9.5_
  - [ ] 3.4 Implement `reconcile.ts` `plan()` for every rule of Requirement 8, the per-repo cap and ordering; table tests plus P5 and P6.
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.7_

- [ ] 4. GitHub ports and fake
  - [ ] 4.1 Write `github/ports.ts` and `github/fake.ts` (`FakeGitHub` over in-memory repos, trees with truncation, blobs, labeled issues, comments, refs; write methods record and can be set to throw).
    - _Requirements: 10.4_
  - [ ] 4.2 Implement `github/dry-run.ts` (`DryRunWriter` recording `PlannedAction`s with synthetic numbers).
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 5. Rate limiting
  - Implement `rate/limiter.ts` (read pool, serialized writes with spacing, header tracking, `exhausted`, retry-after and secondary-limit handling, 5xx/network backoff with jitter) with an injectable clock; tests for P9 and each retry path.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 6. Discovery and inspection
  - [ ] 6.1 Implement `discover.ts` (org listing with fork/archived/disabled filters and repo globs, ref resolution, recursive tree with truncation walk, include/exclude, size/submodule/symlink skips, `--paths` lookup, `maxFilesPerRun`) against `FakeGitHub`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 1.5, 15.3_
  - [ ] 6.2 Implement `inspect.ts` (`isLfsPointer`, time budget, `nodeAdapters`, unknown-kind skip, cache by blob SHA, in-memory only).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 15.1_

- [ ] 7. Orchestration and report
  - [ ] 7.1 Implement `scan.ts` `runScan` (per-repo pipeline, label ensure only before writes, `plan` execution order, per-asset/per-repo error isolation, early stop on rate limit) and `report.ts` (`ScanReport`, `toHuman`, JSON).
    - _Requirements: 11.3, 11.6, 12.1, 12.2, 12.3, 12.4, 15.4_
  - [ ] 7.2 Fake-GitHub scenarios: first run, unchanged second run with zero writes (P4), changed blob, closed-then-new blob, cleaned file, dry run against a throwing writer (P7), token marker (P8).
    - _Requirements: 8.6, 10.4, 3.2_
  - [ ] 7.3 Wire `cli.ts` to `runScan` with exit codes 0/1/2/3 and `--json` stdout discipline; CLI spawn tests against the fake.
    - _Requirements: 1.6, 12.1_

- [ ] 8. Exorcism pull requests
  - Implement `exorcise-pr.ts` (`branchName`, exorcise + verify at threshold, kind-change guard, branch-exists skip, blob → tree → commit → ref → PR, "Closes #n") and the issue notes for incomplete or kind-changed exorcism; fake-GitHub scenarios for each outcome.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ] 9. Octokit adapter
  - Implement `github/octokit.ts` (all routes, pagination, `per_page=100`, PR filtering from issue lists, header-free `GitHubError` mapping, limiter integration) and test it with a stub `request.fetch` covering pagination, 403 secondary limit, 429, 502 and the host allow-list (P10); extend `scripts/check-no-network.ts` to allow only the Octokit adapter to perform HTTP in `packages/crew/src`.
  - _Requirements: 3.2, 5.6, 11.4, 11.5, 15.2_

- [ ] 10. Kiro Crew definitions
  - Write `crew/` job (scheduled, `--json`, token from Crew secrets), agent (counts-only summary) and push webhook (`--repo`, `--ref`, `--paths`) definitions, each headed "verify against current Kiro Crew docs"; verify the formats against the current docs and adjust; add the example `palimpsest-crew.config.json`.
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 2.1_

- [ ] 11. Documentation, public repo and live trial
  - [ ] 11.1 Write `packages/crew/README.md` (setup, token permissions, config reference, Crew definitions, running from cron or GitHub Actions without Crew, the git-history caveat).
    - _Requirements: 3.3, 13.5, 14.1_
  - [ ] 11.2 Confirm the repository holding `packages/crew` is public on the submission account, or add `scripts/mirror-crew.ts` and publish the `palimpsest-crew` mirror; add the visibility line to the submission checklist.
    - _Requirements: 14.1, 14.2, 14.3_
  - [ ] 11.3 Run the bot against a sandbox public repo seeded with Haunted Gallery fixtures, first in dry run, then with issues and PRs; record links in `docs/KIRO_WRITEUP`.
    - _Requirements: 7.1, 9.5, 10.3_
