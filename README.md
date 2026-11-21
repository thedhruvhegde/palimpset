<div align="center">

# PALIMPSEST

### see what your files are still hiding

Drop a photo, screenshot, PDF or Word document.<br>
See every hidden layer it carries, then get a clean copy with proof.<br>
**Everything happens inside your browser. Nothing leaves the page.**

*Kiroween 2026 · Costume Contest · built spec-first with Kiro*

</div>

---

> **Status:** planning complete, implementation in progress in Kiro. See [`docs/COMMIT_PLAN.md`](docs/COMMIT_PLAN.md).

## Why

Files remember more than they show:

- **Cropped screenshots** that still contain the uncropped image ([aCropalypse, CVE-2023-21036](https://nvd.nist.gov/vuln/detail/CVE-2023-21036)).
- **"Redacted" PDFs** where black boxes sit on top of live, selectable text.
- **Photos** carrying GPS to the doorstep, device serial numbers, and a thumbnail from before the edit.
- **PDFs** keeping earlier revisions, and **Word documents** keeping tracked changes, comments and author names.

Existing tools show these as a dry metadata table, or strip them without telling you what was there. Palimpsest makes you *see* it, then makes it gone, then proves it's gone.

## What it does

| | |
|---|---|
| **Séance** | Scrape the vellum to peel back each layer. Every ghost also appears in the Séance Ledger with its severity (revenant, wraith, shade, wisp) and the evidence. |
| **Exorcise** | One click makes a clean copy: re-encoded pixels, rewritten PDFs without history, rasterized bad redactions, documents without tracked changes. The original is never modified. |
| **The Paw** | A property-based adversary (fast-check) that plants random ghosts in generated files and tries to sneak one past the exorcism. Every build must survive it. |
| **For agents** | An MCP server and a Kiro Power so agents scrub attachments before uploading, and a Kiro Crew bot that finds haunted files in GitHub repos. |

## Guarantees (each enforced by a test)

1. Local only: zero network requests (Playwright test over the whole Haunted Gallery).
2. The original file is never mutated.
3. No supported ghost survives exorcism (the Paw).
4. Every planted ghost is detected (the Paw).
5. Parsers never throw or hang on arbitrary bytes (fuzz properties).
6. Anything we can't check is shown as "could not check", never as "clean".

## Built with Kiro

- **Specs:** [`.kiro/specs`](.kiro/specs) holds 9 specs with EARS requirements, design docs with correctness properties mapped 1:1 to property tests, and task plans.
- **Steering:** [`.kiro/steering`](.kiro/steering) covers product, tech, structure, the **threat model** (always on) and **art direction** (loaded for UI files).
- **Hooks:** [`.kiro/hooks`](.kiro/hooks) has six:
  - a no-network guard;
  - summon the Paw on every extractor change;
  - spec-before-code for new formats;
  - a haunted-asset guard that dogfoods Palimpsest on the repo itself;
  - spec/type sync;
  - fixture regeneration.
- **MCP:** [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) registers Palimpsest's own MCP server so Kiro uses it during development.

How Kiro was used in practice: [`docs/KIRO_WRITEUP.md`](docs/KIRO_WRITEUP.md). What existed before Kiro: [`docs/PROVENANCE.md`](docs/PROVENANCE.md).

## Stack

TypeScript (strict) · npm workspaces · Vite · WebGL2 · Web Workers · exifr · pdf.js · pdf-lib · JSZip · zod · Vitest · fast-check · Playwright · MCP TypeScript SDK

```
packages/core   ghost model, extractors, exorcists, the Paw (runs in browser and Node)
apps/web        the web app: drop, reveal, ledger, exorcise, summon the Paw
packages/mcp    MCP server + Kiro Power
packages/crew   Kiro Crew bot: scan repos for haunted files
```

## Live site

https://thedhruvhegde.github.io/palimpset/ (deployed from `main` by GitHub Actions; static only, there is no server by design)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run test:paw   # the Paw (property-based adversary)
npm run build
```

## Design

The Afterimage design system: [`docs/DESIGN.md`](docs/DESIGN.md).

## Credits

aCropalypse research by Simon Aarons and David Buchanan. The bad-redaction detection approach is inspired by Free Law Project's X-Ray.

## License

MIT
