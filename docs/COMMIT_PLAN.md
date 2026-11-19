# Milestones and commit plan (Nov 19 to Dec 4, 2026)

**Hard rule:** the Devpost submission is complete and **Submit has been pressed by Tue Dec 2, 6 PM PT**. Dec 3 and 4 are buffer only.

Commits are small, conventional, lowercase and imperative, and each leaves CI green. Make them in Kiro as you finish spec tasks (Kiro can draft the message; edit it so it's true). Below is the expected sequence. It's a plan, not a script: real commits follow real work.

## Day 1 (Nov 19–20): foundation in Kiro
- Open the repo in Kiro, confirm steering loads (Agent Steering panel shows 5 docs) and hooks are enabled.
- Run `ghost-model-and-ingest` tasks 1–4.
- `chore: scaffold workspace, kiro steering, specs and hooks`
- `feat(core): sniff file kind from magic bytes`
- `feat(core): extractor and exorcist registries with never-throw wrapper`
- `test(core): fuzz property that inspect never throws on arbitrary bytes`

## Days 2–4 (Nov 21–23): image ghosts, the headline reveal
- `feat(core): walk png chunks and report trailing data after iend`
- `feat(core): walk jpeg segments and report trailing data after eoi`
- `feat(core): recover cropped-away png rows from acropalypse trailing data`
- `feat(core): read exif, xmp and gps via exifr with severity mapping`
- `feat(core): surface embedded exif thumbnail as a preview ghost`
- `feat(paw): generate cursed pngs and jpegs with planted ghosts`
- `test(paw): completeness and exorcism-soundness properties for images`
- `feat(scripts): deterministic haunted gallery fixtures`

## Days 5–8 (Nov 24–27): the vellum
- `feat(web): drop zone, worker protocol and inspection flow`
- `feat(web): vellum scrape shader with mask texture and ink-bleed edge`
- `feat(web): place ghost layers by location and fire reveal events`
- `feat(web): seance ledger cards with severity chips and mono evidence`
- `feat(web): keyboard scraping and aria-live reveal announcements`
- `feat(web): self-hosted fonts and tokens from the design canvas`
- `test(web): playwright no-network guarantee across the gallery`

## Days 9–11 (Nov 28–30): exorcism, PDF, the Paw in the app
- `feat(core): image exorcist re-encodes from visible pixels`
- `feat(core): detect text under opaque rectangles in pdfs`
- `feat(core): split incremental pdf revisions at %%eof`
- `feat(core): pdf exorcist rewrites without history and rasterizes bad redactions`
- `feat(core): docx tracked changes, comments, rsids and properties` (cut first if late)
- `feat(web): exorcism result view with verification stats`
- `feat(web): summon the paw view with curling fingers and shrunk trace`

## Days 12–13 (Dec 1–2): agents and Crew
- `feat(mcp): inspect_file and exorcise_file tools with sandboxed paths`
- `feat(power): exorcist power bundling the mcp server, steering and hook`
- `feat(crew): scan repo for haunted files and open redacted issues`
- Enable `.kiro/settings/mcp.json` → `palimpsest` and let the `haunted-asset-guard` hook use it (dogfooding moment for the write-up).

## Day 13 (Dec 2): ship
- Deploy to GitHub Pages; test on a clean browser profile.
- Record the demo (Playwright + ffmpeg, as in SHADE); upload to YouTube, public.
- Write `docs/KIRO_WRITEUP.md` from your notes; fill the Devpost form; **press Submit**; screenshot the confirmation.
- Optional: blog post and #KiroweenHackathon26 social post (credits/subscriptions, not cash).

## Cut list if behind (in order)
1. DOCX (keep PNG, JPEG, PDF).
2. PDF prior revisions (keep bad redactions).
3. Procedural audio.
4. Crew bot's PR mode (keep issue mode).
Never cut: aCropalypse reveal, bad-redaction reveal, exorcism + verification, no-network test, the Paw.
