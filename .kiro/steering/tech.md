---
inclusion: always
---

# Tech stack and conventions

## Stack (versions pinned in package.json)
- **Language:** TypeScript (strict, `noUncheckedIndexedAccess`), ES modules everywhere.
- **Monorepo:** npm workspaces.
  - `packages/core`: pure TypeScript ghost model, extractors and exorcists. **No DOM APIs** except via injected adapters, so it runs in the browser, Node (tests, MCP, Crew) and Web Workers.
  - `apps/web`: Vite app. Vanilla TypeScript with a tiny component pattern (no framework) plus WebGL2 for the vellum scrape shader.
  - `packages/mcp`: MCP server (`@modelcontextprotocol/sdk`, stdio transport) exposing `inspect_file` and `exorcise_file`.
  - `packages/crew`: the Kiro Crew bot that scans a GitHub org for haunted files.
- **Parsing libraries:**
  - `exifr`: EXIF/XMP/IPTC/ICC and the embedded JPEG thumbnail.
  - `pdfjs-dist`: PDF text layer and geometry, for redaction detection and rendering.
  - `pdf-lib`: PDF rewriting for exorcism.
  - `jszip`: DOCX packages.
  - Hand-written chunk walkers for PNG (chunks, IEND trailing data) and JPEG (segments, EOI trailing data). Keep these small and fully tested.
- **Testing:**
  - `vitest` for unit tests.
  - `fast-check` for property-based tests (the Paw).
  - `@playwright/test` for end to end, including the **no-network test** that fails on any request other than the app's own origin.
- **Validation:** `zod` at every boundary (MCP inputs, worker messages, Crew config).

## Rules
- Heavy parsing runs in a **Web Worker** (`apps/web/src/worker.ts`) so the UI never freezes; core functions are pure and take `Uint8Array`.
- Every extractor implements the `Extractor` interface in `packages/core/src/types.ts`. Every exorcist implements `Exorcist`. Don't invent parallel shapes.
- Extractors **never throw** on malformed input. They return what they could parse plus `warnings`. Fuzz properties enforce this.
- No `any`. Prefer discriminated unions. Byte offsets are always numbers relative to the file start.
- No network APIs in `packages/core` or `apps/web/src` (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, remote `import()`). The only exception is the explicit, opt-in map-tile request described in the `threat-model` steering doc.
- Bundle size budget: initial JS ≤ 250 KB gzip. Lazy-load `pdfjs-dist` and `jszip` when a matching file is dropped.
- Commit messages: conventional commits, lowercase, imperative (`feat(core): detect png trailing data after iend`).
