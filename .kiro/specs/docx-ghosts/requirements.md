# Requirements Document

## Introduction

This spec defines the DOCX extractor (`packages/core/src/extractors/docx/`). A DOCX file is a ZIP package of XML parts. People share it believing it shows only the visible text, but it often still carries deleted text from tracked changes, reviewers' comments and names, revision session ids that can link documents to each other, author and company properties, hidden text, image alt text, and images that have their own ghosts (GPS, device serials, uncropped pixels).

The extractor reports these kinds from `types.ts`: `tracked-change`, `comment`, `revision-id`, `docx-properties`, `author-identity`, `software-trail` and `capture-time` (both listed in `carries('docx')` in the ghost-model spec), and `embedded-media-ghost` (built with the core `nestGhosts` helper). For hidden text (`w:vanish`) and alt text, it needs two new kinds, `hidden-text` and `alt-text`, set out as a proposed change to `types.ts` in design.md.

The ZIP container is read with `jszip` (pinned at 3.10.2, loaded lazily) behind a hand-written central-directory guard that enforces zip-bomb and size limits before any inflate runs. XML parts are parsed with a small hand-written streaming tag scanner that works the same in browsers, Web Workers and Node, needs no `DOMParser`, and never expands entities.

Terms:
- **Part:** one ZIP entry, such as `word/document.xml`.
- **Main part:** the part targeted by the `officeDocument` relationship in `_rels/.rels`.
- **Story parts:** the main part plus headers, footers, footnotes, endnotes and comments. Text can appear in all of them.
- **Expanded name:** `{namespaceURI}localName`. The scanner matches on expanded names, never on prefixes.
- **Nested inspection:** running the registry on an embedded part's bytes through `ctx.inspectNested`.

## Requirements

### Requirement 1: Extractor contract and lazy loading

**User Story:** As a core developer, I want the DOCX extractor to follow the shared contract and load jszip only when a DOCX is dropped, so that it fits the registry and the bundle budget.

#### Acceptance Criteria

1. The system SHALL export `extractor: Extractor` from `packages/core/src/extractors/docx/index.ts` with `kind: 'docx'` and `detects` equal to `['tracked-change', 'comment', 'revision-id', 'docx-properties', 'author-identity', 'software-trail', 'capture-time', 'hidden-text', 'alt-text', 'embedded-media-ghost']`.
2. The system SHALL load `jszip` only through a dynamic `import()` on first use, and SHALL NOT include it in the web app's initial chunk.
3. The system SHALL NOT throw or reject from `extract` for any input. It SHALL return what it found plus `warnings` and `unchecked`.
4. The system SHALL NOT mutate the input bytes. It SHALL pass jszip either a copy or a read-only view that jszip cannot detach.
5. The system SHALL use ghost ids `${kind}:${n}`, numbered per kind in emission order.
6. The system SHALL use no DOM API (`DOMParser`, `XMLSerializer`, `document`). `TextDecoder` is allowed.

### Requirement 2: ZIP safety limits

**User Story:** As a user dropping a file from an untrusted sender, I want a malicious archive to be refused safely, so that the tab never freezes or runs out of memory (G5).

#### Acceptance Criteria

1. The system SHALL parse the End of Central Directory record, and the Zip64 record when present, plus every central-directory entry itself, before calling jszip.
2. IF the package has more than 10,000 entries THEN the system SHALL stop, add the warning `zip-too-many-entries`, and mark every kind `unchecked`.
3. IF the sum of declared uncompressed sizes is more than 512 MB, or any single entry declares more than 128 MB THEN the system SHALL skip the offending entries (or the whole package for the total), add `zip-size-limit`, and mark the affected kinds `unchecked`.
4. IF an entry's compressed-to-uncompressed ratio is more than 200:1 and its uncompressed size is more than 1 MB THEN the system SHALL skip that entry and add `zip-ratio-limit`.
5. IF two entries' local file data ranges overlap (overlapping-entry zip bomb) THEN the system SHALL refuse the package, add `zip-overlapping-entries`, and mark every kind `unchecked`.
6. WHILE inflating any entry, the system SHALL count output bytes, and SHALL abort that entry with `zip-size-mismatch` once the output passes its declared size or the per-entry limit, whichever is lower.
7. IF two central-directory entries have the same name (case-insensitively) THEN the system SHALL add `zip-duplicate-entry` naming the path, SHALL inspect every copy, and SHALL report a ghost found in any copy. Word and jszip may pick different copies.
8. IF an entry has the encryption flag set, or uses a compression method other than 0 (store) or 8 (deflate) THEN the system SHALL skip it, add `zip-entry-unsupported`, and mark kinds that depend on that part `unchecked`.
9. IF the bytes are not a ZIP, or contain no main part THEN the system SHALL add `docx-not-a-package` and mark every kind `unchecked`.
10. The system SHALL check `ctx.signal` between entries, and every 8,192 scanner events within a part.

### Requirement 3: Streaming XML scanner

**User Story:** As a core developer, I want one small XML scanner that behaves the same in every runtime and cannot be turned against us, so that DOCX parsing is safe and portable.

#### Acceptance Criteria

1. The system SHALL tokenize XML into `open`, `close` and `text` events, with namespace resolution through an `xmlns` scope stack, and SHALL expose element and attribute names as expanded names.
2. The system SHALL decode the predefined entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`) and numeric character references, and SHALL leave any other entity reference as literal text and add `xml-unknown-entity`.
3. The system SHALL skip a `<!DOCTYPE ...>` declaration, including its internal subset, without processing it, and SHALL add `xml-doctype-ignored`. Entity expansion is never done, which rules out billion-laughs and external-entity attacks.
4. The system SHALL skip comments, processing instructions and `CDATA` markers. CDATA content SHALL be emitted as text.
5. The system SHALL decode part bytes as UTF-8 by default, and as UTF-16LE or UTF-16BE when a BOM says so, using `TextDecoder` with `fatal: false`.
6. The system SHALL limit element depth to 512, attributes per element to 512, and name length to 1,024 characters. It SHALL truncate a single text event to 1 MiB, and add `xml-limit` when any limit is hit.
7. IF the XML is malformed (an unclosed tag at end of input, a mismatched close tag, a stray `<`) THEN the system SHALL recover: it SHALL emit synthetic closes for open elements and treat stray markup as text, and SHALL add `xml-malformed` with the character offset. It SHALL never throw.
8. The system SHALL give each `open` event a positional path (for example `/w:document[1]/w:body[1]/w:p[7]/w:del[1]`) using the prefixes as written, for `GhostLocation.xpath`.
9. The system SHALL process a 64 MB part in time linear in its length.

### Requirement 4: Package discovery

**User Story:** As a core developer, I want the extractor to find parts by their relationships rather than by fixed names, so that renamed or non-Word-generated packages are still checked.

#### Acceptance Criteria

1. The system SHALL find the main part from the `officeDocument` relationship in `_rels/.rels`, and SHALL fall back to `word/document.xml` with the warning `docx-main-part-guessed`.
2. The system SHALL find the comments, settings, header, footer, footnotes, endnotes, people, commentsExtended and image parts from the main part's `.rels`, resolving relative targets against the source part's folder.
3. The system SHALL find the core, app and custom properties parts from the package `_rels/.rels`, falling back to `docProps/core.xml`, `docProps/app.xml` and `docProps/custom.xml`.
4. The system SHALL record relationships with `TargetMode="External"` and SHALL NOT resolve them as parts.
5. The system SHALL treat every entry under `word/media/` and `word/embeddings/` as an embedded-media candidate, whether or not a relationship targets it.

### Requirement 5: Tracked changes

**User Story:** As an HR editor, I want to see every deletion and insertion still recorded in the document, and who made it and when, so that a "final" letter doesn't carry its earlier wording.

#### Acceptance Criteria

1. The system SHALL emit a `tracked-change` ghost for each `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `w:rPrChange`, `w:pPrChange`, `w:sectPrChange`, `w:tblPrChange`, `w:cellIns` and `w:cellDel` element in any story part.
2. For deletions, the system SHALL gather the text of `w:delText` and `w:delInstrText` inside the element. For insertions and moves, it SHALL gather `w:t`. It SHALL cut the text to 500 characters with an ellipsis.
3. `evidence.fields` SHALL include `Change` (Deletion, Insertion, Move from, Move to, Formatting change, …), `Author` (`w:author`), `Date` (`w:date`, ISO 8601), `Text`, `Change id` (`w:id`) and `Part`.
4. `evidence.summary` SHALL show deleted text in the form `Deleted by <author>: "<text>"`.
5. The system SHALL set severity to `wraith` for a deletion or move-from with non-empty text, and `shade` for all other changes.
6. The location SHALL be `{ type: 'zip-entry', path, xpath }` pointing at the change element.
7. WHEN a part has more than 100 tracked changes THEN the system SHALL emit the first 100 one by one, and one more grouped ghost per `(Change, Author)` pair with a `Count` field, and SHALL add `docx-changes-grouped`.

### Requirement 6: Comments

**User Story:** As a lawyer sending a contract, I want to see every comment and its author, including resolved ones, so that internal notes don't reach the other side.

#### Acceptance Criteria

1. The system SHALL emit one `comment` ghost per `w:comment` in the comments part, with fields `Author`, `Initials`, `Date`, `Text` (paragraphs joined by newlines, cut to 1,000 characters), `On text` (the main-part text between the matching `w:commentRangeStart` and `w:commentRangeEnd`, cut to 200 characters) and `Resolved`.
2. The system SHALL set `Resolved: yes` WHEN `word/commentsExtended.xml` has a `w15:commentEx` whose `w15:paraId` matches the comment's last paragraph and whose `w15:done="1"`.
3. The system SHALL set severity to `wraith` and confidence to 1.0.
4. WHEN a comment exists in the comments part but nothing in the main part refers to it (an orphan) THEN the system SHALL still report it, with `On text: (no anchor)`.

### Requirement 7: Revision session ids

**User Story:** As a whistleblower, I want to know that my document carries ids that can link it to other documents edited on the same machine, so that I can strip them before sharing.

#### Acceptance Criteria

1. The system SHALL gather `w:rsidRoot` and every `w:rsid` from the settings part, and every `w:rsidR`, `w:rsidRPr`, `w:rsidRDefault`, `w:rsidP`, `w:rsidDel`, `w:rsidSect` and `w:rsidTr` attribute value in story parts.
2. WHEN at least one rsid value is found THEN the system SHALL emit exactly one `revision-id` ghost, with fields `rsidRoot`, `Distinct sessions` (count), `Sample` (up to 8 values) and `Also present` (`w14:paraId`/`w14:textId` count, if any).
3. The explanation SHALL say that rsids are random 32-bit session ids: Word writes one per editing session, `rsidRoot` survives "Save As", and two documents sharing rsid values were very likely edited from the same original, which can link an anonymous document to a known one.
4. The system SHALL put the full sorted list of distinct values in `evidence.raw` as `{ root: string | null; values: string[] }`, so that the MCP and Crew tools can compare documents.
5. The system SHALL set severity to `shade` and confidence to 1.0. The location SHALL be the settings part at the `w:rsids` element, or else the first story part that has an rsid attribute.

### Requirement 8: Document properties and author identity

**User Story:** As a person sending a CV, I want to see the creator, last editor, company and template path stored in the file, so that an old employer's name doesn't go with it.

#### Acceptance Criteria

1. The system SHALL read `dc:creator`, `cp:lastModifiedBy`, `dc:title`, `dc:subject`, `dc:description`, `cp:keywords`, `cp:category`, `cp:revision`, `cp:lastPrinted`, `dcterms:created` and `dcterms:modified` from the core part; `Application`, `AppVersion`, `Company`, `Manager`, `Template`, `TotalTime` and `HyperlinkBase` from the app part; every `property` name and value from the custom part; and the `attachedTemplate` relationship target from the settings part's `.rels`.
2. WHEN a properties part has at least one non-empty field THEN the system SHALL emit one `docx-properties` ghost for that part, with every non-empty field in `evidence.fields`.
3. The system SHALL set `docx-properties` severity to `wraith` WHEN a value contains a user-profile path (`C:\Users\<name>`, `/Users/<name>`, `/home/<name>`) or a UNC path; `shade` WHEN it contains Company, Manager, title, subject, keywords, custom properties or dates; and `wisp` WHEN it contains only Application, AppVersion or counts.
4. WHEN `dc:creator`, `cp:lastModifiedBy` or `Manager` is non-empty THEN the system SHALL emit one `author-identity` ghost per distinct name (severity `wraith`), with a `Roles` field (for example `creator, last modified by`).
5. WHEN `word/people.xml` lists a `w15:person` with a `w15:presenceInfo` whose `w15:userId` looks like an email address or a SID THEN the system SHALL emit an `author-identity` ghost with severity `revenant`, with fields `Author`, `Provider` and `User id`.
6. WHEN `Application`, `AppVersion` or the `attachedTemplate` target is non-empty THEN the system SHALL emit one `software-trail` ghost (severity `wisp`) listing them. WHEN `dcterms:created`, `dcterms:modified`, `cp:lastPrinted` or `TotalTime` is non-empty THEN the system SHALL emit one `capture-time` ghost (severity `wisp`), with dates in ISO 8601 and `TotalTime` in minutes. Both SHALL use the location of the properties part they come from.
7. The system SHALL read `customXml/item*.xml` parts and emit one `docx-properties` ghost per item whose leaf text values (up to 20) include an email, phone number or path (by `pii-patterns.ts` or the path rule in 8.3), or come from an element whose local name contains `Author`, `Owner`, `Editor` or `User`.

### Requirement 9: Hidden text

**User Story:** As a paralegal, I want to know about text formatted as hidden, so that the notes I hid from view don't get sent.

#### Acceptance Criteria

1. The system SHALL mark a run as hidden WHEN its `w:rPr` has `w:vanish` or `w:specVanish` without `w:val` set to `0`, `false` or `off`, or WHEN its character style or paragraph style, following `w:basedOn` up to 10 levels, sets `w:vanish`.
2. The system SHALL merge consecutive hidden runs in a paragraph, and emit one `hidden-text` ghost per merged span with non-whitespace text, with fields `Text` (cut to 500 characters), `Part` and `Via` (`direct formatting` or `style <styleId>`).
3. The system SHALL set severity to `wraith` IF the text matches a PII pattern, and `shade` otherwise.
4. The system SHALL NOT report hidden paragraph marks with no text.

### Requirement 10: Image alt text

**User Story:** As someone sharing a document with photos, I want to see the descriptions attached to images, so that an auto-caption like "Ada Quill standing outside 12 Raven Row" doesn't leak.

#### Acceptance Criteria

1. The system SHALL read `descr` and `title` from `wp:docPr` and `pic:cNvPr`, and `alt` and `o:title` from VML `v:shape`/`v:imagedata`, in story parts.
2. WHEN `descr`, `title` or `alt` is non-empty and is not a default name matching `^(Picture|Image|Grafik|Imagen)\s*\d+$` THEN the system SHALL emit an `alt-text` ghost with fields `Description`, `Title`, `Image part` (the resolved `r:embed` target) and `Part`.
3. The system SHALL set severity to `wraith` IF the text matches a PII pattern, and `shade` otherwise.

### Requirement 11: Ghosts inside embedded media

**User Story:** As a user, I want a photo pasted into a document checked for its own ghosts, so that GPS or an aCropalypse tail inside the image is not missed.

#### Acceptance Criteria

1. For each embedded-media candidate of at most 64 MB, the system SHALL call `ctx.inspectNested(bytes, ctx)`, passing its own `ctx` unchanged. The orchestrator (ghost-model spec, Requirement 7) inspects at `ctx.depth + 1` and refuses depth 4 with `max-depth`.
2. The system SHALL emit `nestGhosts(inner, { type: 'zip-entry', path })` for every returned inspection. Each inner ghost therefore becomes an `embedded-media-ghost` with `location: { type: 'nested', container: { type: 'zip-entry', path }, inner: innerGhost.location, innerKind: inner.kind }`, the inner severity, confidence and evidence (with any preview), and `evidence.raw = { innerGhost }` (`NestedGhostRaw`, core `nested.ts`).
3. Ghosts from deeper nesting (a DOCX inside a DOCX) SHALL nest recursively, so that a ghost two levels down has a `nested` location whose `inner` is itself `nested`.
4. The system SHALL NOT copy nested warnings or add `embedded-media-ghost` to `unchecked` for inspections that `inspectNested` returned. The orchestrator does both (ghost-model Requirement 7.5).
5. IF a candidate is skipped by this extractor (over 64 MB, beyond the 200th entry, or failed to inflate) THEN the system SHALL add `embedded-media-ghost` to `unchecked`, and add `docx-media-unchecked` naming the path and the reason.
6. The system SHALL inspect at most 200 embedded entries, with `docx-media-truncated` beyond that.

### Requirement 12: Output limits

**User Story:** As a user, I want the Séance Ledger to stay readable on huge documents, so that the important ghosts aren't buried.

#### Acceptance Criteria

1. The system SHALL emit at most 1,000 ghosts per inspection. Beyond that, it SHALL add `docx-ghost-limit` and add the kinds that hit the limit to `unchecked`.
2. The system SHALL cut every evidence string value to 1,000 characters, ending with `…`.
3. The system SHALL skip XML parts larger than 64 MB uncompressed, with `docx-part-too-large`, and mark that part's kinds `unchecked`.
