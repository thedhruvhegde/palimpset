---
inclusion: always
---

# Product: Palimpsest

**One line:** drop a file onto cursed vellum, scrape it to reveal every hidden layer it carries, then exorcise them, all inside the browser.

## Who it's for
- **Everyday sharers** about to post a screenshot or photo (journalists' sources, people selling things online, survivors of stalking, anyone posting their pets).
- **People who redact documents** (paralegals, HR, small-newsroom editors) and need to know whether a "redacted" PDF really is.
- **Developers and agents** who need to sanitize attachments before uploading them (MCP server, Kiro Power, Crew bot).

## The problem
Files leak far more than they show: cropped screenshots that still contain the uncropped image (aCropalypse, CVE-2023-21036), EXIF GPS and device serials, embedded thumbnails from before an edit, PDF "redactions" that are just black rectangles over live text, earlier PDF revisions kept by incremental saves, and DOCX tracked changes, comments and author names. Existing tools show these as a dry metadata table, or strip them without explaining what was there.

## What makes it different
1. **The reveal is the product.** Scraping the vellum peels each layer back visually: the cropped region rises, hidden names bleed through redaction bars, GPS appears as a street name. People understand the risk because they see it.
2. **Exorcise and verify.** Cleaning re-runs every extractor on the output, and **the Paw**, a property-based adversary, plants random ghosts in generated files and proves none survive.
3. **Nothing leaves the page.** All parsing happens client-side. Zero network requests is a tested guarantee, not a promise.

## Ghost vocabulary (use these words in UI and code)
- **Ghost:** one piece of hidden information found in a file.
- **Severity:** `revenant` (identity or location exposed), `wraith` (directly identifying), `shade` (indirectly identifying), `wisp` (low risk alone).
- **Séance:** the reveal session for one file. **Séance Ledger:** the list of ghosts.
- **Exorcise:** produce a clean copy. **Banished:** a ghost confirmed absent from the output.
- **The Paw:** the property-based adversary. A **curse** is a generated file with planted ghosts. A **curled finger** is a found counterexample.

## Non-goals
- Not a forensic tool for court evidence. Results are best effort and say so.
- No accounts, no cloud processing, no telemetry.
- No video files in v1.

## Hackathon context
Kiroween 2026, Costume Contest category, also aiming for Best Demo and Best Kiro Crew App. The spooky UI must make the function clearer, never hide it. Deadline: Dec 4 2026, 2:00 PM PT. Submit at least 48 hours early.
