---
inclusion: always
---

# Repository structure

```
.kiro/                 steering, specs, hooks, MCP settings (committed; never gitignore)
apps/web/              Vite app: drop zone, vellum scrape view, Séance Ledger, exorcism, the Paw view
  src/ui/              components (one file each), tokens.css, shaders/
  src/worker.ts        runs core extractors/exorcists off the main thread
packages/core/src/
  types.ts             the Ghost model and Extractor/Exorcist contracts (source of truth)
  formats/             sniff.ts (magic bytes → FileKind)
  extractors/<kind>/   one folder per format: png/, jpeg/, heic/, pdf/, docx/
  exorcists/<kind>/    one folder per format
  paw/                 fast-check arbitraries that build cursed files, plus the property suites
  index.ts             public API: inspect(bytes), exorcise(bytes), and the registries
packages/mcp/          MCP server + Kiro Power manifest
packages/crew/         Kiro Crew bot (scheduled org scan → issues/PRs)
fixtures/haunted-gallery/  generated cursed sample files (built by scripts/make-fixtures.ts, never real personal data)
scripts/               make-fixtures.ts, check-no-network.ts, record-demo.ts
docs/                  PROVENANCE, DESIGN, DEMO_SCRIPT, COMMIT_PLAN, KIRO_WRITEUP
```

## Conventions
- Tests sit next to code: `foo.ts` + `foo.test.ts`; property suites are `*.prop.test.ts`.
- One extractor per format folder exposes `export const extractor: Extractor`.
- Fixtures are **generated**, deterministic and committed, so tests and the demo are reproducible.
- New file formats need a spec in `.kiro/specs/` before code (the `new-format-spec` hook scaffolds one).
