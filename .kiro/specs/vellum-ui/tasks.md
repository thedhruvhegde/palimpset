# Implementation Plan

Prerequisite: `packages/core` exports `inspect`, `exorcise` and `sniff` from `src/index.ts` (core spec). Until the Paw suites land, tasks 13 and 14 run against the proposed `PawReport` shape with a stub `summonPaw`. Every task ends with `npm run typecheck && npm test -w apps/web` green.

- [ ] 1. Scaffold `apps/web` and the build checks
  - Create `apps/web/package.json`, `vite.config.ts` (worker `format: 'es'`, build manifest on), `tsconfig.json` extending the root strict config, `index.html` with `#app`, the CSP meta tag and empty polite/assertive live regions.
  - Add `scripts/check-bundle.ts` (initial-chunk gzip ≤ 250 KB, banned lazy modules) and `scripts/check-no-network.ts` (AST scan of `apps/web/src` and `packages/core/src`, `opt-in-map.ts` allow-listed) and wire both into `npm run build -w apps/web`.
  - _Requirements: 3.3, 22.2, 22.3, 23.4_

- [ ] 2. Tokens, fonts and base styles
  - [ ] 2.1 Write `src/ui/tokens.css` with every art-direction token and the severity chip colours; write `tokens.test.ts` that parses `.kiro/steering/art-direction.md` and `tokens.css` and compares them.
    - _Requirements: 19.1, 19.2_
  - [ ] 2.2 Add WOFF2 files and OFL licenses to `public/fonts`, `src/ui/fonts.css` with `@font-face` + `font-display: swap`, preload the display and body regular faces; add a build assertion that `dist` contains no `fonts.googleapis.com` / `fonts.gstatic.com` and fonts total ≤ 400 KB.
    - _Requirements: 19.3, 19.4, 19.5, 22.4_
  - [ ] 2.3 Base styles: crypt background, Instrument Sans body 16–21 px / 1.55, mono evidence class, 2 px ecto focus ring, 44 px minimum targets.
    - _Requirements: 19.5, 19.6_

- [ ] 3. State, router and app shell
  - [ ] 3.1 Implement `state.ts` (`Component<P>`, `createStore`, `AppState`) and `router.ts` with the four hash routes and the no-file redirect; unit tests for redirect and state reset on new file.
    - _Requirements: 1.1, 1.2, 1.4_
  - [ ] 3.2 Implement `ui/app-shell.ts` and `ui/announcer.ts` (polite/assertive regions, 300 ms batching, 500 ms cursor debounce) with fake-timer tests.
    - _Requirements: 1.1, 18.1, 18.3, 18.4_
  - [ ] 3.3 Preference storage for `palimpsest.sound` and `palimpsest.motion-override` with `try/catch` fallbacks; test with a throwing `localStorage`.
    - _Requirements: 1.3, 1.5, 16.5_

- [ ] 4. Worker and protocol
  - [ ] 4.1 Write `worker-protocol.ts` zod schemas for every `ToWorker` / `FromWorker` variant; tests for round-trip and rejection of malformed messages.
    - _Requirements: 5.2_
  - [ ] 4.2 Implement `worker.ts` (inspect, exorcise, docx-text, cancel; time budget `max(2000, 2000 × MB)`; browser `PlatformAdapters`) and `worker-client.ts` (copy-then-transfer, AbortSignal → `cancel`, crash recovery).
    - _Requirements: 5.1, 5.4, 5.5, 5.6_
  - [ ] 4.3 Test P11: after `exorcise` via the client, the original is byte-equal and not detached; add the development-build G2 assertion.
    - _Requirements: 5.5, 13.4_

- [ ] 5. Landing screen
  - [ ] 5.1 Implement `ui/drop-zone.ts`: label + hidden input, document-level `dragover`/`drop` prevention, hover state, multi-file announcement, 50 MB limit, `kind: 'unknown'` message.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  - [ ] 5.2 Implement `ui/privacy-promise.ts` (three pills, explanation dialog with G1, the map exception and the out-of-scope list).
    - _Requirements: 3.1, 3.2_
  - [ ] 5.3 Implement `vite-plugins/haunted-gallery.ts` (zod-validated manifest, one lazy chunk per fixture) and `ui/haunted-gallery.ts` (button cards, severity chip, load → same path as drop); add the manifest-vs-`inspect` count test.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ] 5.4 Compose `ui/landing-view.ts` (hero copy from the canvas) and route `#/`.
    - _Requirements: 1.1, 2.1, 3.1, 4.1_

- [ ] 6. Original rendering and ghost layout
  - [ ] 6.1 Implement `scrape/layout.ts` (`resolveLocation`, `layoutGhosts` with the six ordered rules, band columns, content union, crop-line edge) with P1–P4 property tests.
    - _Requirements: 6.5, 6.6, 6.7_
  - [ ] 6.2 Implement `render/original.ts` for PNG/JPEG (`createImageBitmap`), PDF (lazy `pdfjs-dist`, ≤ 20 pages, viewport transforms), DOCX (worker `docx-text`, Canvas2D manuscript) and the placeholder surface; enforce the 4096 px cap.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 22.5_
  - [ ] 6.3 Implement `render/ghost-layer.ts`: teal base, preview bitmaps, fitted mono text for `pdf-region` ghosts, band cards; wait for fonts with a 3 s fallback.
    - _Requirements: 6.8, 8.3_

- [ ] 7. Pure scrape logic
  - [ ] 7.1 Implement `scrape/stroke.ts` (`interpolateStroke`, pressure mapping) with P5.
    - _Requirements: 7.3, 7.5_
  - [ ] 7.2 Implement `scrape/coverage.ts` (`regionToCells`, `scrapedFraction`, `crossings` at 0.35) with P6 and P7.
    - _Requirements: 9.2, 9.3, 9.4, 9.6_
  - [ ] 7.3 Implement `scrape/keyboard-grid.ts` (12 × 8, arrows scrape, Shift+arrows move, Space, Enter) with P8 and P9.
    - _Requirements: 17.2, 17.3, 17.4, 17.5, 17.6_

- [ ] 8. WebGL2 vellum
  - [ ] 8.1 Implement `scrape/gl.ts` helpers (program compile/link with logs, R8/RGBA8 textures, FBOs, PBO + `fenceSync` readback) and `shaders/fullscreen.vert`, `noise.glsl`.
    - _Requirements: 7.1, 9.1_
  - [ ] 8.2 Stamp pass: `stamp.vert`/`stamp.frag`, instanced quads, `blendEquation(MAX)`, 128 stamps/frame cap; pointer capture, coalesced events, `touch-action: none`; mask clear on new file.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ] 8.3 Downsample pass and throttled async readback feeding `coverage.ts`; emit batched `onReveal`.
    - _Requirements: 9.1, 9.4, 9.5_
  - [ ] 8.4 Composite pass: vellum/ghost mix, 4-octave ink-bleed edge, ink ring, ecto tint, 16-point glow trail with 800 ms fade, `u_showOriginal`, `u_revealAll` 600 ms, per-region 600 ms bleed-up for revenant/wraith; idle when nothing changes.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [ ] 8.5 Keyboard input on the focused canvas (focus ring, cursor cell overlay, accessible name/description, scoped `preventDefault`) and context-loss handling; Playwright shader smoke test.
    - _Requirements: 16.4, 17.1, 17.7, 17.8_

- [ ] 9. Fallback vellum
  - Implement `ui/vellum-fallback.ts` (DOM regions, CPU mask grid, same coverage, 200 ms crossfade) and the selection logic (reduced motion, no WebGL2, context loss, motion override); Playwright test with `reducedMotion: 'reduce'`.
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [ ] 10. Séance screen
  - [ ] 10.1 Implement `ui/scrape-toolbar.ts` and `ui/reveal-progress.ts` (header file line, "N of M ghosts revealed", progressbar ARIA).
    - _Requirements: 10.1, 10.3, 10.4_
  - [ ] 10.2 Implement `ui/severity-chip.ts`, `ui/ghost-card.ts` (title, chip, mono evidence and fields via `textContent`, explanation, `sourceLine`, "Possible ghost") and `ui/seance-ledger.ts` (ordering, "k more ghosts", exorcise button and note); P12 test and `sourceLine` table tests.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 19.7_
  - [ ] 10.3 Implement `ui/unseen-panel.ts` ("What we can't see", warnings expanded when present).
    - _Requirements: 12.1, 12.2_
  - [ ] 10.4 Compose `ui/seance-view.ts`: inspection lifecycle with Cancel, vellum selection, reveal → state → ledger → announcer, "Reveal all layers" batch announcement, zero-ghost honest message; keyboard-only Playwright séance.
    - _Requirements: 5.3, 9.5, 10.2, 10.5, 18.2_

- [ ] 11. Opt-in map
  - Implement the GPS card button and confirmation dialog in `ghost-card.ts`, and `ui/opt-in-map.ts` (`tileUrlsFor` 3 × 3 at zoom 15, `referrerpolicy="no-referrer"`, marker, attribution) loaded only by dynamic import after confirmation; unit test for tile math.
  - _Requirements: 11.6, 21.1, 21.2, 21.3, 21.4, 21.5_

- [ ] 12. Exorcise action
  - Implement the exorcise flow in `seance-view.ts`, `ui/vermilion-particles.ts` and `seance-ledger.burn()` (120 ms stagger, teal check, reduced-motion fade), failure recovery and the assertive completion announcement.
  - _Requirements: 13.1, 13.2, 13.3, 16.3, 18.5_

- [ ] 13. Exorcism result screen
  - [ ] 13.1 Implement `afterStatus` and `cleanFileName` with P10 tests; `ui/before-after.ts` with the four statuses as text plus colour.
    - _Requirements: 14.2, 14.3, 19.7_
  - [ ] 13.2 Implement `ui/verification-panel.ts` (output ghost count, survivors in vermilion, quick Paw run of 200 runs / 4000 ms for the output kind) and `paw` messages in the worker (lazy `fast-check` chunk).
    - _Requirements: 14.4, 14.5, 15.7_
  - [ ] 13.3 Implement `util/download.ts` and `ui/download-button.ts`; compose `ui/exorcism-view.ts` (headline, warnings, navigation links).
    - _Requirements: 14.1, 14.6, 14.7, 14.8_

- [ ] 14. The Paw screen
  - Implement `ui/paw-fingers.ts` (five decorative fingers, 500 ms curl, reduced-motion instant), `ui/curse-trace.ts` (counterexample fields and trace lines, "No curse worked" state) and `ui/paw-view.ts` (summon with streamed progress every ≤ 250 ms, replay with stored seed/path, text property list, assertive curl announcement).
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.8, 18.6_

- [ ] 15. Opt-in sound
  - Implement `audio/haunt-audio.ts` (in-memory noise, formant whisper by severity, six-voice choir, 10 ms cut, −12 dBFS cap, visibility suspend) and `ui/sound-toggle.ts` (no `AudioContext` before opt-in); unit test with a mocked `AudioContext` constructor counting instantiations.
  - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [ ] 16. No-network guarantee and accessibility gate
  - [ ] 16.1 Playwright G1 test against `vite preview`: every gallery fixture via gallery and file input, reveal all, exorcise, download, Paw view; fail on any foreign-origin request or WebSocket; Chromium and Firefox in CI.
    - _Requirements: 23.1, 23.2, 23.5_
  - [ ] 16.2 Playwright map test: no tile request without confirmation; only `tile.openstreetmap.org` tile URLs after it.
    - _Requirements: 21.1, 23.3_
  - [ ] 16.3 `@axe-core/playwright` scan of all four screens (zero serious violations) and a contrast assertion for text tokens.
    - _Requirements: 19.6, 17.7_

- [ ] 17. Performance verification
  - Add the `@perf` Playwright script (5 s scripted scrape, rAF intervals p95 ≤ 16.7 ms, no long task > 50 ms), run it on the reference laptop and record the results in `docs/DESIGN.md`; confirm GPU resources are deleted on séance end with a WebGL resource counter in dev builds.
  - _Requirements: 22.1, 22.5_
