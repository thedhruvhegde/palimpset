# Requirements Document

## Introduction

This spec covers `apps/web`, the Palimpsest web app: a Vite + vanilla TypeScript single-page app (no UI framework) with a WebGL2 "vellum" that the user scrapes to reveal the hidden layers of a file. It implements the four screens of the design canvas (https://claude.ai/artifact/JH8SvA8MKrSyeW62ZzcoHA): **Landing**, **Séance**, **Exorcism result** and **The Paw**, plus the cross-cutting guarantees from the steering docs: G1 (local only, enforced by a Playwright no-network test), G2 (original untouched), G6 (honest output), accessibility, self-hosted fonts, opt-in sound and the opt-in map.

All file parsing and cleaning is done by `packages/core` (`inspect`, `exorcise`, the Paw suites) running in a Web Worker. The UI consumes only the shapes in `packages/core/src/types.ts` (`Inspection`, `Ghost`, `GhostLocation`, `Exorcism`, `Severity`, `SEVERITY_ORDER`, `FileKind`, `GhostKind`). Two additions to `types.ts` are proposed in `design.md` (preview placement and the Paw report); every requirement below degrades gracefully if the optional placement field is absent.

Terms: **vellum** is the paper surface showing the file; **ghost layer** is the texture holding every ghost's visual; **mask** is the R8 texture recording where the user has scraped; **ghost region** is the rectangle on the vellum where a ghost is drawn; **ghost band** is the strip below the file rendering that holds ghosts with no visual position (byte ranges, chunks, revisions, zip entries).

## Requirements

### Requirement 1: App shell, routing and in-memory state

**User Story:** As a user, I want the app to move between landing, séance, exorcism and the Paw without reloading, so that my file stays in memory and nowhere else.

#### Acceptance Criteria

1. The system SHALL use hash routes `#/`, `#/seance`, `#/exorcism` and `#/paw`, rendered into a single app shell with a header showing the Palimpsest wordmark and the sound toggle.
2. WHEN the route is `#/seance` or `#/exorcism` AND no file is loaded in memory THEN the system SHALL redirect to `#/`.
3. The system SHALL hold file bytes, `Inspection` and `Exorcism` results only in JavaScript memory; it SHALL NOT write them to the URL, `localStorage`, `sessionStorage`, IndexedDB, the Cache API or a service worker.
4. WHEN the user returns to `#/` and drops a new file THEN the system SHALL discard the previous file's bytes, inspection, exorcism, mask and WebGL textures before inspecting the new file.
5. The system SHALL persist only two preferences in `localStorage` (`palimpsest.sound`, `palimpsest.motion-override`), wrapping every read and write in `try/catch` and falling back to defaults when storage is unavailable.

### Requirement 2: Drop zone

**User Story:** As an everyday sharer, I want to lay my file on the vellum by dragging, clicking or using the keyboard, so that I can check it before posting.

#### Acceptance Criteria

1. The Landing screen SHALL show a vellum drop zone with the heading "Lay your file upon the vellum", the line "Drop a photo, screenshot, PDF or Word document, or choose one", and the mono line "JPEG · PNG · HEIC · PDF · DOCX, up to 50 MB".
2. The drop zone SHALL be a `<label>` wrapping a visually hidden `<input type="file">`, so that click, Enter and Space open the file chooser and the control is reachable with Tab.
3. WHEN a file is dragged over the drop zone THEN the system SHALL show a hover state (lapis-300 inner glow) and SHALL call `preventDefault` on `dragover` and `drop` at the document level so the browser never navigates to the file.
4. WHEN more than one file is dropped THEN the system SHALL use the first file and announce "Only one file at a time. Using <name>." via the polite live region.
5. IF the file is larger than 52,428,800 bytes THEN the system SHALL NOT read it and SHALL show "This file is larger than 50 MB. Palimpsest checks files up to 50 MB."
6. WHEN a file is accepted THEN the system SHALL read it with `File.arrayBuffer()`, keep the resulting `Uint8Array` as the immutable original, navigate to `#/seance` and start inspection (Requirement 5).
7. IF `inspect` returns `kind: 'unknown'` THEN the system SHALL show "Palimpsest doesn't know this file type, so nothing was checked." and SHALL NOT show the word "clean" or a ghost count of zero (G6).
8. The file kind SHALL be taken from `Inspection.kind` (magic bytes), never from the file name or MIME type.

### Requirement 3: Privacy promise

**User Story:** As a cautious user, I want to see the privacy promise before I drop anything, so that I trust the page with a sensitive file.

#### Acceptance Criteria

1. The Landing screen SHALL show, directly under the drop zone, a pill reading "Nothing leaves this page. Zero network requests, verified in CI." with a lock icon, and two secondary pills "Works offline" and "Open source, MIT".
2. The privacy pill SHALL link to an in-page explanation (dialog or section) listing what is tested (G1), the single opt-in exception (the map), and "What we can't see" (steganography, forensic recovery of overwritten data, video).
3. The system SHALL serve a Content-Security-Policy in `index.html` (meta tag) with `default-src 'self'; connect-src 'self'; img-src 'self' blob: data: https://tile.openstreetmap.org; font-src 'self'; worker-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'`.

### Requirement 4: Haunted Gallery

**User Story:** As a judge or visitor without a suitable file, I want to try generated cursed specimens, so that I can see the séance immediately.

#### Acceptance Criteria

1. The Landing screen SHALL show "The Haunted Gallery" with the subtitle "No file handy? Try one of these cursed specimens." and one card per fixture in `fixtures/haunted-gallery/manifest.json`.
2. Each card SHALL show the specimen name (display face), file name (mono), a one-line description, and a chip "<n> ghosts" colored by the highest severity among its expected ghosts, with the severity name in the chip's accessible label.
3. WHEN a card is activated (click, Enter or Space) THEN the system SHALL load the fixture bytes through a lazily imported module bundled with the app (no `fetch`) and proceed exactly as if the file had been dropped (Requirement 2.6).
4. The gallery's displayed ghost counts SHALL equal `inspect(bytes).ghosts.length` for each fixture; a unit test SHALL fail if the manifest disagrees with `inspect`.
5. Gallery cards SHALL be real `<button>` elements with a minimum target size of 44 × 44 px.

### Requirement 5: Inspection off the main thread

**User Story:** As a user dropping a large PDF, I want the page to stay responsive while it is examined, so that I can cancel or keep reading.

#### Acceptance Criteria

1. The system SHALL run `inspect` and `exorcise` from `packages/core` in a dedicated module Web Worker (`apps/web/src/worker.ts`), never on the main thread.
2. Every message between the main thread and the worker SHALL be validated with zod on receipt; IF a message fails validation THEN the receiver SHALL drop it and log a warning to the console without throwing.
3. WHEN inspection starts THEN the Séance screen SHALL show "Summoning the séance…" with a Cancel button; WHEN Cancel is pressed THEN the system SHALL abort via `AbortSignal` and return to `#/`.
4. The worker SHALL enforce a time budget of `max(2000, 2000 × size_in_MB)` ms; WHEN the budget elapses THEN the system SHALL show the partial `Inspection` with a warning "Time ran out; some layers were not checked."
5. The main thread SHALL send the worker a copy of the original bytes (a new `ArrayBuffer`, transferred), so that the original buffer held by the UI is never detached or mutated (G2).
6. WHEN the dropped file is a PDF or DOCX THEN the system SHALL load the PDF or DOCX code paths (`pdfjs-dist`, `jszip`) through dynamic `import()` only at that moment.

### Requirement 6: Rendering the original and placing ghosts

**User Story:** As a user, I want each hidden layer to sit where it belongs on my file, so that I understand what it exposes.

#### Acceptance Criteria

1. WHEN the kind is `png` or `jpeg` THEN the system SHALL render the visible image with `createImageBitmap` onto the vellum, preserving aspect ratio.
2. WHEN the kind is `pdf` THEN the system SHALL render every page (up to 20 pages; further pages listed as "not drawn" but still inspected) with `pdfjs-dist`, stacked vertically with a 24 px gap, and SHALL keep each page's viewport transform for ghost placement.
3. WHEN the kind is `docx` THEN the system SHALL render a plain manuscript of the visible body text (paragraphs from `word/document.xml`, without deleted runs) onto a vellum page.
4. IF the browser cannot decode the visible content (for example HEIC outside Safari) THEN the system SHALL show a vellum placeholder reading "This browser can't draw <KIND> files, but every layer was still checked." and SHALL place all ghosts in the ghost band.
5. The system SHALL compute one ghost region per ghost with a pure function, using these rules in order:
   1. IF `evidence.preview.placement` is present THEN the region SHALL be that rect in the visible content's coordinate space (image pixels for images; PDF user space on the location's page for PDFs).
   2. IF the location is `pdf-region` THEN the region SHALL be `rect` on `page`, converted from PDF user space (origin bottom left) to vellum space with the page's viewport transform.
   3. IF the ghost is `recovered-image` with a preview and no placement THEN the region SHALL be anchored at the visible image's top-left with the preview's pixel size, at the same pixel scale as the visible image.
   4. IF the ghost is `embedded-thumbnail` with a preview and no placement THEN the region SHALL be the visible image's rect, with the preview fitted inside it.
   5. IF the location is `nested` THEN the rules SHALL be applied to its `container`.
   6. Otherwise (`byte-range`, `chunk`, `pdf-revision`, `zip-entry`) the region SHALL be a card slot in the ghost band.
6. WHEN any region extends beyond the visible content (a recovered crop) THEN the vellum SHALL grow to the union of all regions and SHALL draw a dashed vermilion "crop line" with a "crop line" tag at the visible content's edge.
7. The ghost band SHALL lay out card slots in rows sorted by `SEVERITY_ORDER` then `id`, with `max(1, floor(bandWidthCss / 280))` columns.
8. The ghost layer SHALL draw: preview pixels for ghosts with a preview; for `pdf-region` ghosts without a preview, `evidence.summary` set in IBM Plex Mono fitted into the rect; for band slots, a card with the ghost title and `evidence.summary`.

### Requirement 7: Scrape mask

**User Story:** As a user, I want to scrape the vellum with my pointer, so that the hidden layers rise where I drag.

#### Acceptance Criteria

1. The system SHALL keep the scrape state in an R8 mask texture attached to a framebuffer, at `ceil(0.5 × vellum drawing-buffer size)` per axis.
2. WHEN the Scrape tool is active AND a pointer (mouse, pen or touch) is pressed and moved over the vellum THEN the system SHALL stamp a soft circular brush into the mask along the stroke, including coalesced pointer events.
3. Brush stamps SHALL be spaced at most `0.35 × radius` apart along the stroke, so that fast strokes leave no gaps.
4. Stamps SHALL combine with `gl.blendEquation(gl.MAX)`, so that the mask only grows during a séance.
5. The brush radius SHALL be 28 CSS px (scaled by drawing-buffer ratio) and pen pressure, when reported, SHALL scale stamp strength between 0.4 and 1.0.
6. WHILE a touch scrape is in progress the vellum SHALL set `touch-action: none` so that scraping does not scroll the page; outside the vellum the page SHALL scroll normally.
7. WHEN a new file is loaded THEN the system SHALL clear the mask to 0.

### Requirement 8: Composite rendering

**User Story:** As a user, I want scraping to look like ink lifting off old paper with something glowing underneath, so that the reveal feels like discovery and reads as "this was hidden".

#### Acceptance Criteria

1. The composite pass SHALL output, per fragment, a mix of the vellum layer (paper texture plus the rendered original) and the ghost layer, weighted by the scraped mask value after edge noise.
2. The mask edge SHALL be perturbed by a 4-octave value-noise field so that edges look like ink bleed, and the transition band SHALL be darkened toward `--ink-900`.
3. Revealed ghost-layer pixels SHALL be tinted toward `--lapis-100` over a dark teal base, so that revealed content reads as "this was hidden" (lapis-300 meaning).
4. An lapis glow in `--lapis-300` SHALL follow the most recent stroke positions and fade to zero within 800 ms of the last movement.
5. WHEN "Show original only" is on THEN the composite SHALL show only the vellum layer, without clearing the mask; turning it off SHALL restore the scraped state.
6. WHEN "Reveal all layers" is activated THEN the mask SHALL animate to fully scraped over 600 ms (instantly under reduced motion).
7. WHEN a revealed ghost's severity is `revenant` or `wraith` THEN its region SHALL bleed up over 600 ms (ghost-layer opacity ramp within the region) before its ledger card slides in.

### Requirement 9: Reveal events

**User Story:** As a user, I want a ghost to count as found once I have scraped enough of it, so that the ledger fills in as I explore.

#### Acceptance Criteria

1. The system SHALL read back a downsampled copy of the mask no more often than every 100 ms while scraping, using an asynchronous pixel-buffer readback that does not stall the frame.
2. A mask cell SHALL count as scraped WHEN its mean mask value is at least 0.5.
3. The scraped fraction of a ghost region SHALL be the overlap-area-weighted fraction of scraped cells intersecting the region; regions smaller than one cell SHALL use the cells they intersect.
4. WHEN a ghost region's scraped fraction first exceeds 0.35 THEN the system SHALL emit exactly one `reveal` event for that ghost id.
5. WHEN a ghost is revealed THEN the system SHALL add it to the revealed set, update the progress (Requirement 10.4), insert its ledger card (Requirement 11) and announce it (Requirement 18).
6. Revealed state SHALL never revert during a séance, including when "Show original only" is toggled.

### Requirement 10: Séance toolbar and progress

**User Story:** As a user, I want clear tools and a running count, so that I know how much is left to find.

#### Acceptance Criteria

1. The Séance screen SHALL show a toolbar with three buttons: "Scrape" (toggle, `aria-pressed`), "Reveal all layers" and "Show original only" (toggle, `aria-pressed`), plus the hint "Drag across the vellum to scrape back the layers".
2. WHEN "Reveal all layers" is activated THEN every ghost SHALL be revealed and announced once as a batch ("All <M> ghosts revealed.").
3. The header SHALL show the file name, size and kind in mono (for example "dog_crop.png · 412 KB · PNG").
4. The header SHALL show "<N> of <M> ghosts revealed" and a `role="progressbar"` with `aria-valuemin="0"`, `aria-valuemax="<M>"` and `aria-valuenow="<N>"`.
5. WHEN M is 0 AND `Inspection.unchecked` is empty AND there are no warnings THEN the system SHALL show "No ghosts found in the layers we can check." and the "What we can't see" panel; it SHALL NOT show "clean" without that qualifier (G6).

### Requirement 11: Séance Ledger

**User Story:** As a user, I want every revealed ghost listed with plain evidence, so that I can read exactly what my file leaks.

#### Acceptance Criteria

1. The Séance screen SHALL show a "Séance Ledger" panel with the total ghost count and one card per revealed ghost, ordered by `SEVERITY_ORDER` then reveal order.
2. Each card SHALL show the ghost `title`, a severity chip, `evidence.summary` and every `evidence.fields` entry in IBM Plex Mono, the ghost `explanation`, and a source line derived from `location` (for example "PNG chunk tEXt · bytes 33–140", "PDF page 2", "word/document.xml").
3. The severity chip SHALL show the severity name as text and use the art-direction chip colors (revenant solid vermilion on #1A0808, wraith vermilion 18% tint with #F59A86, shade gold 16% tint with #E4C27A, wisp #9AA3C7 16% tint with #B3BBDB).
4. IF a ghost's `confidence` is below 0.6 THEN its card SHALL be labeled "Possible ghost".
5. WHILE some ghosts are unrevealed the ledger SHALL show one muted card "<k> more ghosts" with "Keep scraping, or use Reveal all layers."
6. WHEN a GPS ghost (`kind: 'gps-location'`) card is shown THEN it SHALL show coordinates and, if present, the offline place name from `evidence.fields`, plus the button "Show on map (sends coordinates to OpenStreetMap tiles)" (Requirement 21).
7. The ledger SHALL end with the primary vermilion button "Exorcise all <M> ghosts" and the note "Runs locally. Your original is never modified."; the button SHALL be enabled whether or not all ghosts are revealed.
8. Evidence strings SHALL be inserted as text (`textContent`), never as HTML.

### Requirement 12: What we can't see, and warnings

**User Story:** As a paralegal, I want to know what Palimpsest could not check, so that I don't mistake "nothing found" for "safe".

#### Acceptance Criteria

1. The Séance screen SHALL show a collapsible "What we can't see" panel listing every `Inspection.unchecked` ghost kind with a human label, followed by the fixed out-of-scope list: steganography, forensic recovery of overwritten data, video files.
2. WHEN `Inspection.warnings` is non-empty THEN the panel SHALL be expanded by default and list each warning's `message` (and `offset` in mono when present).

### Requirement 13: Exorcise action

**User Story:** As a user, I want one button to clean the file, with a visible ending, so that I know the cleaning finished.

#### Acceptance Criteria

1. WHEN "Exorcise all <M> ghosts" is activated THEN the system SHALL call `exorcise` in the worker on a copy of the original bytes with default `ExorciseOptions`, and disable the button with the label "Exorcising…".
2. WHILE exorcism runs the ledger cards SHALL burn away one by one (120 ms stagger) with vermilion particles, then show silence and a teal check, then navigate to `#/exorcism`.
3. IF exorcism rejects or the worker reports an error THEN the system SHALL keep the user on the séance, restore the cards and show "The exorcism failed: <message>. Your original is unchanged."
4. After exorcism the system SHALL assert in development builds that the original `Uint8Array` is byte-equal to its pre-exorcism copy (G2) and log an error if not.

### Requirement 14: Exorcism result

**User Story:** As a user, I want to see what was removed and proof that it stayed removed, so that I trust the clean file.

#### Acceptance Criteria

1. The Exorcism screen SHALL show "Exorcism complete" and the headline "<B> ghosts banished", where B is the sum of `Exorcism.banished[].count`.
2. The screen SHALL show a "Before" list (one row per original ghost: title and a short mono value) and an "After" list with one row per original ghost and exactly one status: "banished" (ecto check) IF no ghost of that kind is in `verification.ghosts` and the kind appears in `banished`; "survived" (vermilion) IF a ghost of that kind is in `verification.ghosts`; "could not check" IF the kind is in `verification.unchecked`; "not removed" otherwise.
3. The header of each list SHALL show the file name and size in mono; the clean file name SHALL be `<stem>.clean.<ext>`, with `<ext>` derived from `verification.kind`.
4. The screen SHALL show the panel "The Paw tried to break this exorcism" with the stat "<verification.ghosts.length> ghosts found in output" and the stat "<runs> cursed files tried" from a time-boxed Paw run (Requirement 15.7) for the same `FileKind`.
5. WHEN `verification.ghosts` contains any ghost THEN the panel SHALL say "<n> ghosts survived" in vermilion and list them; it SHALL NOT say "0".
6. The primary button "Download clean file" SHALL save `Exorcism.output` using a `Blob`, an object URL and an `<a download>` click, then revoke the URL; no network request SHALL occur.
7. The screen SHALL offer "Watch the Paw's attempts" (to `#/paw`) and "Exorcise another file" (to `#/`, discarding state per Requirement 1.4).
8. `Exorcism.warnings` SHALL be listed under the lists when present.

### Requirement 15: The Paw view

**User Story:** As a judge, I want to watch the property-based adversary attack the exorcists, so that I believe the verification claim.

#### Acceptance Criteria

1. The Paw screen SHALL show the heading "The Paw grants three wishes. Each one is a leak.", an explanation paragraph, five fingers, stats ("Cursed files tried", "Ghost kinds planted", "Fingers curled: <c> of 5"), and the buttons "Summon the Paw" and "Replay last curse".
2. Each finger SHALL correspond to one Paw property, in this order: detects every planted ghost (G4), banishes every removable ghost (G3), leaves the original untouched (G2), never throws or hangs (G5), exorcism is idempotent.
3. WHEN "Summon the Paw" is activated THEN the system SHALL run the Paw suites in the worker (lazy-loaded, including `fast-check`) for all supported kinds with a fresh random seed, streaming progress so that "Cursed files tried" updates at least every 250 ms.
4. WHEN a property fails THEN its finger SHALL curl (rotate and shorten over 500 ms; instantly under reduced motion), its label SHALL read "<property>: curled", and the trace panel "The curse that worked" SHALL show the shrunk counterexample: property, seed, path, shrink count, file kind and size, planted ghosts, and the trace lines.
5. WHEN a run finishes with no failures THEN all fingers SHALL stay straight and the trace panel SHALL read "No curse worked in <runs> attempts."
6. "Replay last curse" SHALL re-run the failing property with the stored seed and path, and SHALL be disabled until a counterexample exists.
7. The Exorcism screen's quick Paw run SHALL be limited to the exorcised `FileKind`, 200 runs or 4000 ms, whichever ends first.
8. Fingers SHALL be decorative (`aria-hidden`); their state SHALL be conveyed by a text list of the five properties with "holds" or "curled".

### Requirement 16: Reduced motion and WebGL fallback

**User Story:** As a user with vestibular sensitivity, or on a device without WebGL2, I want the same information without the animation, so that the app works for me.

#### Acceptance Criteria

1. WHEN `prefers-reduced-motion: reduce` matches, OR WebGL2 is unavailable, OR the WebGL context is lost THEN the system SHALL use the fallback vellum: the original drawn in a DOM layer with ghost regions as absolutely positioned elements.
2. In the fallback, pointer scraping and keyboard scraping SHALL reveal a ghost when the pointer path or keyboard cursor touches cells covering more than 35% of its region (same coverage function as Requirement 9), and the region SHALL crossfade in over 200 ms (no shader, no noise, no glow).
3. Under reduced motion the system SHALL disable vermilion particles, finger animations and the 600 ms bleed-up, replacing them with opacity changes of at most 200 ms.
4. WHEN the WebGL context is lost mid-séance THEN the revealed set SHALL be preserved in the fallback.
5. The header SHALL offer a "Motion: system / reduced" override stored in `palimpsest.motion-override`.

### Requirement 17: Keyboard scraping

**User Story:** As a keyboard user, I want to scrape with the arrow keys, so that I don't need a pointer.

#### Acceptance Criteria

1. The vellum SHALL be focusable with Tab and SHALL show an lapis-300 focus ring and a visible scrape cursor cell.
2. The system SHALL divide the vellum content (including the ghost band) into a 12 × 8 grid; the cursor SHALL start at column 1, row 1.
3. WHEN an arrow key is pressed THEN the cursor SHALL move one cell in that direction (clamped at edges) and the destination cell SHALL be fully scraped.
4. WHEN Shift plus an arrow key is pressed THEN the cursor SHALL move without scraping.
5. WHEN Space is pressed THEN the current cell SHALL be scraped without moving.
6. WHEN Enter is pressed on the focused vellum THEN all layers SHALL be revealed (same as "Reveal all layers").
7. The vellum SHALL expose an accessible name and description: "Scrapeable vellum. Arrow keys scrape, Shift plus arrows move, Enter reveals all layers."
8. Arrow, Space and Enter handling SHALL be scoped to the focused vellum and SHALL call `preventDefault` only for those keys.

### Requirement 18: Screen-reader announcements

**User Story:** As a screen-reader user, I want to hear each ghost as it is revealed, so that I follow the séance without seeing the shader.

#### Acceptance Criteria

1. The app shell SHALL contain one visually hidden `aria-live="polite"` region and one `aria-live="assertive"` region, present in the DOM from first paint.
2. WHEN a ghost is revealed THEN the polite region SHALL announce "Ghost revealed: <title>, <severity>. <evidence.summary>".
3. WHEN more than one ghost is revealed within 300 ms THEN the system SHALL combine them into one announcement "<k> ghosts revealed: <title 1>, <title 2>, …".
4. WHEN keyboard scraping moves the cursor THEN the system SHALL announce "Row <r> of 8, column <c> of 12" in the polite region, debounced to 500 ms.
5. WHEN exorcism completes THEN the system SHALL announce "<B> ghosts banished. <S> ghosts found in output." in the assertive region.
6. WHEN a Paw finger curls THEN the system SHALL announce "A finger curled: <property>." in the assertive region.

### Requirement 19: Visual tokens and fonts

**User Story:** As a designer, I want the app to use exactly the art-direction tokens and self-hosted fonts, so that it matches the canvas and keeps G1.

#### Acceptance Criteria

1. `apps/web/src/ui/tokens.css` SHALL define on `:root` exactly the art-direction tokens with the specified hex values: `--void-950` #08070B, `--void-900` #12101A, `--void-800` #1B1826, `--line` #2A2536, `--bone-100` #F1ECE2, `--bone-300` #C7C0D4, `--bone-500` #A39CB4, `--parchment-200` #EFE3C8, `--parchment-400` #D9C79F, `--gold-500` #C9A24A, `--ink-900` #1D1626, `--lapis-300` #7D9BFF, `--lapis-100` #E6ECFF, `--vermilion-500` #E5452B, `--gold-400` #D4A64A.
2. A unit test SHALL parse `tokens.css` and the art-direction steering table and fail if any token is missing or differs.
3. The system SHALL self-host Cormorant SC (400), Instrument Sans (400, 400 italic, 500, 600) and IBM Plex Mono (400, 600) as WOFF2 in `apps/web/public/fonts` with their OFL license files, declared with `@font-face` and `font-display: swap`.
4. The built app SHALL contain no reference to `fonts.googleapis.com` or `fonts.gstatic.com`.
5. Body text SHALL be Instrument Sans 16–21 px with line-height 1.55; every concrete value (bytes, coordinates, names, offsets) SHALL be set in IBM Plex Mono 12–15 px; headings and hero numbers SHALL use Cormorant SC.
6. All text SHALL meet a 4.5:1 contrast ratio against its background; focus rings SHALL be 2 px `--lapis-300`; interactive targets SHALL be at least 44 × 44 px.
7. Severity SHALL never be conveyed by color alone: every chip and status SHALL include the severity or status name as text.

### Requirement 20: Opt-in procedural sound

**User Story:** As a demo viewer, I want optional eerie sound, so that the reveal is more dramatic, without anything playing unless I ask.

#### Acceptance Criteria

1. The header SHALL show a sound toggle button, off by default, labeled "Sound off" / "Sound on" with `aria-pressed`.
2. The system SHALL NOT create an `AudioContext` until the user turns sound on.
3. WHILE sound is on, WHEN a ghost is revealed THEN the system SHALL play a procedurally synthesized whisper (filtered noise with gliding formants, at most 1 s), pitched by severity (lower for revenant).
4. WHILE sound is on, WHEN exorcism runs THEN the system SHALL play a rising synthesized choir that cuts to silence (10 ms release) when the teal check appears.
5. The system SHALL use no audio files and no network for sound, SHALL cap master gain at −12 dBFS, and SHALL suspend the `AudioContext` when the document is hidden.

### Requirement 21: Opt-in map

**User Story:** As a user with a GPS ghost, I want to optionally see the location on a map, knowing exactly what that sends, so that I understand the risk without being exposed by default.

#### Acceptance Criteria

1. By default a GPS ghost SHALL show coordinates and the offline place name only; no map tile SHALL be requested.
2. All map code SHALL live in `apps/web/src/ui/opt-in-map.ts`, loaded by dynamic `import()` only after the user activates "Show on map (sends coordinates to OpenStreetMap tiles)".
3. WHEN activated THEN the system SHALL show a confirmation stating "This sends the tile coordinates for this location to tile.openstreetmap.org." with "Send and show map" and "Cancel"; only "Send and show map" SHALL request tiles.
4. The map SHALL draw a 3 × 3 grid of 256 px tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` at zoom 15 with a marker and the attribution "© OpenStreetMap contributors", using `<img referrerpolicy="no-referrer">`.
5. The map SHALL never send file bytes or any value other than the tile coordinates implied by the URL.

### Requirement 22: Performance budgets

**User Story:** As a user on an ordinary laptop, I want scraping to feel smooth and the page to load fast, so that the reveal feels physical.

#### Acceptance Criteria

1. WHILE scraping on the reference machine (Intel Iris Xe class integrated GPU, Chrome stable, 1920 × 1080 at DPR 1.25) the 95th-percentile frame interval SHALL be at most 16.7 ms and no main-thread long task SHALL exceed 50 ms.
2. The initial JavaScript (the entry chunk plus every chunk statically imported or `modulepreload`ed by `index.html`) SHALL be at most 250 KB gzip; a build check SHALL fail the build when exceeded.
3. `pdfjs-dist`, `jszip`, `fast-check` and `opt-in-map.ts` SHALL NOT be in the initial JavaScript; a build check SHALL fail if any of them appears in an initial chunk.
4. Self-hosted fonts SHALL total at most 400 KB, and only the display and body regular faces SHALL be preloaded.
5. Ghost-layer and original textures SHALL be capped at 4096 px on the longest side (downscaled if larger), and all GPU resources SHALL be deleted when a séance ends.

### Requirement 23: No-network guarantee (G1)

**User Story:** As a privacy-conscious user, I want a test to prove that no file data leaves the page, so that the promise is a guarantee.

#### Acceptance Criteria

1. A Playwright test SHALL serve the production build with `vite preview` and record every request from the page, its workers and WebSockets.
2. For every Haunted Gallery fixture, loaded both through the gallery and through the file input, the test SHALL inspect, reveal all layers, exorcise, download the clean file and open the Paw view; it SHALL fail on any request whose origin is not the app's own origin.
3. A second Playwright test SHALL open a GPS fixture without activating the map and fail on any request to `tile.openstreetmap.org`; it SHALL then activate and confirm the map and assert that the only foreign requests are tile URLs on `tile.openstreetmap.org`.
4. A static check (`scripts/check-no-network.ts`) SHALL fail CI if `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon` or a non-relative `import()` appears in `apps/web/src` outside `apps/web/src/ui/opt-in-map.ts`.
5. The Playwright tests SHALL run in Chromium and Firefox in CI.
