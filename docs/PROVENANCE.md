# Provenance: who built what

Kiroween rules ask entrants to disclose pre-existing work and to show how Kiro was used. This file keeps that record honest. Update it as you go.

## Before Kiro (planning, Nov 19 2026)
Drafted with Claude (Anthropic) during idea selection and planning:
- The idea itself, chosen through a multi-agent idea tournament (40 ideas, 2 judges, 1 adversarial critic).
- The `.kiro/steering/*` documents, the `.kiro/specs/*` requirements/design/tasks drafts, and the `.kiro/hooks/*` definitions. These are **inputs** to Kiro, reviewed and edited before implementation.
- The UI design canvas (Vellum & Ectoplasm design system, 5 screens): https://claude.ai/artifact/JH8SvA8MKrSyeW62ZzcoHA
- The workspace scaffold: package manifests, TypeScript config, CI workflow, design tokens (`apps/web/src/ui/tokens.css`) and the ghost model contract (`packages/core/src/types.ts`).

## Core library started outside Kiro (Nov 19 2026)
By decision, a first slice of the pure parsing core was implemented with Claude Code, following the Kiro specs exactly. It is listed here so judges can tell it apart from Kiro work:
- `packages/core/src/ghost-kinds.ts`, `schema.ts`, `nested.ts`, `util/bytes.ts`, `util/crc32.ts`
- `packages/core/src/formats/sniff.ts`, `formats/zip-names.ts` (ghost-model-and-ingest tasks 1–4)
- `packages/core/src/registry/*` (task 6), `orchestrator/budget.ts`, `finalize.ts`, `unchecked.ts`, `inspect.ts` (tasks 7–10, inspect only)
- `packages/core/src/extractors/png/walk.ts`, `extractors/jpeg/walk.ts`, `shared/trailing.ts` and the trailing-data-only PNG/JPEG extractors (image-ghosts tasks 2–4, plus the basic JPEG walker from task 8)
- tests for all of the above and `packages/core/test-support/*`

Everything else, including aCropalypse reconstruction, EXIF/XMP/GPS, thumbnails, ICC, PDF, DOCX, exorcism, the Paw, the web app, MCP, the Power and the Crew bot, is to be built in Kiro.

## Built with Kiro (from the first Kiro session onward)
Every feature in `packages/core`, `apps/web`, `packages/mcp` and `packages/crew` is implemented in Kiro by executing the spec task lists, with steering and hooks active. Record notable moments in `docs/KIRO_WRITEUP.md` as they happen (a hook catching a network call, the Paw finding a leak, a spec change that saved time).

## Third-party code
Dependencies are listed in `package.json` files with exact versions. Algorithms adapted from published work are credited inline and in the README, for example:
- aCropalypse (CVE-2023-21036) recovery approach.
- Bad-redaction detection in the style of Free Law Project's X-Ray.
