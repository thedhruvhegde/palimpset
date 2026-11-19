# Requirements Document

## Introduction

This spec defines the PDF extractor (`packages/core/src/extractors/pdf/`), which finds the ghosts a PDF carries and hands them to the Séance view. It covers five ghost kinds from `types.ts`: `unredacted-text` (live text under an opaque shape drawn later, the "bad redaction"), `prior-revision` (earlier versions kept by incremental saves), `pdf-metadata` (Info dictionary and XMP), `hidden-annotation` (hidden or non-viewable annotations and comments) and `embedded-file` (attachments). It also reports `author-identity`, `software-trail` and `capture-time` taken from document-level metadata (the `types.ts` comment on `author-identity` names PDF authors, and `carries('pdf')` in the ghost-model spec lists all three), and `embedded-media-ghost` for ghosts inside attached files, wrapped with the core `nestGhosts` helper.

The extractor uses `pdfjs-dist` (pinned at 6.5.438, loaded lazily) for the object model, the operator list, text, annotations, attachments and rendering. A small hand-written raw-byte scanner handles what pdf.js normalizes away: `%%EOF` boundaries, `startxref` and `/Prev` chains, linearization, encryption markers and uncompressed XMP packets. The bad-redaction detector follows the approach of Free Law Project's X-Ray: find filled rectangles that are drawn over text. It goes further by using paint order from the operator list.

The extractor is best effort and says so (G6). Scanned PDFs, text drawn as vector outlines, PDFs that need a password and anything cut short by the time budget are reported as warnings plus `unchecked` kinds, never as clean.

Terms:
- **Operator list:** the ordered list of drawing operators pdf.js produces for a page (`page.getOperatorList()`), including annotation appearance streams.
- **Cover:** an opaque filled region (rectangle path, opaque image or unapplied Redact annotation) in page user space.
- **Glyph box:** the estimated rectangle a single glyph occupies in page user space.
- **Coverage:** for a glyph box, the area covered by the union of covers painted later, divided by the glyph box area.
- **Revision boundary:** the byte offset just past an `%%EOF` marker that ends a complete, loadable PDF prefix.

## Requirements

### Requirement 1: Extractor contract and lazy loading

**User Story:** As a core developer, I want the PDF extractor to follow the shared `Extractor` contract and load pdf.js only when needed, so that it plugs into the registry and does not inflate the initial bundle.

#### Acceptance Criteria

1. The system SHALL export `extractor: Extractor` from `packages/core/src/extractors/pdf/index.ts` with `kind: 'pdf'` and `detects` equal to `['unredacted-text', 'prior-revision', 'pdf-metadata', 'author-identity', 'software-trail', 'capture-time', 'hidden-annotation', 'embedded-file', 'embedded-media-ghost']`.
2. The system SHALL load `pdfjs-dist` only through a dynamic `import()` the first time `extract` is called, and SHALL reuse the loaded module for later calls.
3. WHEN the web app is built THEN the system SHALL NOT include `pdfjs-dist` in the initial JS chunk (bundle budget of 250 KB gzip, tech steering).
4. The system SHALL let the host replace the pdf.js loader (for example, to set a same-origin `workerSrc`) through a module-level `setPdfjsLoader` function, without changing `types.ts`.
5. The system SHALL return ghost ids of the form `${kind}:${n}`, where `n` counts from 0 per kind in the order ghosts are emitted.
6. The system SHALL NOT throw or reject from `extract` for any input. It SHALL return the ghosts it found, plus `warnings` and `unchecked`.

### Requirement 2: Safe and local pdf.js configuration

**User Story:** As a person checking a sensitive PDF, I want parsing to happen locally without touching my original bytes, so that guarantees G1 and G2 hold.

#### Acceptance Criteria

1. The system SHALL pass pdf.js a copy of the input (`bytes.slice()`), so that pdf.js transferring the buffer to its worker can never detach or change the caller's `Uint8Array` (G2).
2. The system SHALL call `getDocument` with `cMapUrl`, `standardFontDataUrl` and `wasmUrl` unset, `useWorkerFetch: false`, `enableXfa: false`, `stopAtErrors: false` and `verbosity: 0`, so that pdf.js makes no network request (G1).
3. WHEN pdf.js reports a missing CMap or standard font THEN the system SHALL continue, and SHALL add the warning `pdf-font-data-missing` once per document.
4. WHEN `ctx.signal` aborts THEN the system SHALL call `loadingTask.destroy()`, stop processing pages, return what it found so far, add the warning `budget-exceeded`, and add each kind it had not finished checking to `unchecked`.
5. The system SHALL check `ctx.signal` before each page, and after every 5,000 operators while walking an operator list.

### Requirement 3: Raw-byte scanning

**User Story:** As a core developer, I want a small scanner that reads the PDF's file structure directly, so that revisions and encryption are found even when pdf.js cannot open the file.

#### Acceptance Criteria

1. The system SHALL find every `%%EOF` marker in the input, and SHALL record each marker's boundary as the offset after the marker and its end-of-line (CR, LF or CRLF), or the end of the file.
2. The system SHALL accept a `%%EOF` as a revision boundary only IF a `startxref` keyword followed by a decimal offset appears within the 1,024 bytes before the marker, and that offset points before the marker to either the keyword `xref` or an indirect object whose dictionary has `/Type /XRef`.
3. IF the first indirect object in the file has a `/Linearized` key THEN the system SHALL NOT treat the `%%EOF` that ends the first-page section as a revision boundary.
4. The system SHALL follow the `/Prev` chain from the last `startxref`, through classic trailers and cross-reference stream dictionaries, with at most 1,024 steps and no repeated offset. It SHALL mark each boundary whose `startxref` offset is on the chain as `confirmed`.
5. The system SHALL detect `/Encrypt` in any trailer or cross-reference stream dictionary and report it as `encrypted: true`.
6. The system SHALL find uncompressed XMP packets (`<?xpacket begin` up to the matching `<?xpacket end ...?>`) and record their byte ranges.
7. The system SHALL finish a scan of a 100 MB input in linear time, with no regular expression running over the whole buffer. Any backward search SHALL be limited to a fixed window.
8. IF the input does not start with `%PDF-` within its first 1,024 bytes THEN the system SHALL add the warning `pdf-no-header` and continue.

### Requirement 4: Unredacted text (bad redactions)

**User Story:** As a paralegal who redacted a PDF by drawing black boxes, I want to see any text still alive under those boxes, so that I don't publish names I thought were hidden.

#### Acceptance Criteria

1. The system SHALL rebuild glyph boxes for each page from its operator list. It SHALL track the graphics state (`save`, `restore`, `transform`, form XObject matrices), the text state (font, size, character spacing, word spacing, horizontal scaling, leading, rise, text matrix and line matrix) and the advance of each glyph, using the `unicode`, `width` and `isSpace` of each glyph in `showText` arguments.
2. The system SHALL record a cover for each `constructPath` operator whose paint operator fills (`fill`, `eoFill`, `fillStroke`, `eoFillStroke`, `closeFillStroke`, `closeEOFillStroke`) and whose path is a single closed four-corner polygon. Each cover SHALL carry its operator index, its device-independent quadrilateral in page user space, its fill color and its fill alpha.
3. The system SHALL treat a cover as opaque only WHEN fill alpha (`ca`) ≥ 0.95, no soft mask is active, and the blend mode is `Normal`.
4. The system SHALL count an opaque cover against a glyph only IF the cover's operator index is greater than the glyph's operator index (painted later).
5. WHEN a glyph's coverage by the union of opaque later covers is ≥ 0.60 THEN the system SHALL mark the glyph as hidden.
6. The system SHALL merge consecutive hidden glyphs from the same line into one span, and SHALL emit one `unredacted-text` ghost per span. The ghost SHALL have `location: { type: 'pdf-region', page, rect }`, with a 1-based `page` and `rect` equal to the union of the span's glyph boxes in page user space (origin bottom-left, positive width and height). `evidence.summary` SHALL quote the hidden text, and `evidence.fields` SHALL include `Text`, `Page`, `Cover color` and `Coverage`.
7. The system SHALL also treat as covers the appearance of an annotation with `/Subtype /Redact` that has not been applied, and the unit square of a `paintImageXObject` placed by the current matrix. Redact covers SHALL be treated as painted after all page content.
8. The system SHALL set confidence as follows: 0.99 for text under an unapplied Redact annotation; 0.95 for an axis-aligned rectangle cover whose fill luminance ≤ 0.2; 0.85 for any other opaque axis-aligned rectangle cover; 0.75 for a rotated rectangle cover; 0.5 for an image cover. WHEN the optional pixel check (Requirement 4.11) confirms a uniform cover THEN confidence SHALL rise to at least 0.9.
9. The system SHALL set severity to `revenant` IF the hidden text matches a shared PII pattern (email address, phone number, national-ID-shaped digit group or street address), and `wraith` otherwise.
10. IF a glyph has no Unicode mapping THEN the system SHALL still compute its coverage, SHALL show the glyph as `U+FFFD` in evidence, and SHALL add the warning `pdf-no-unicode` with the page number.
11. WHERE the `rasterizePdfPage` adapter is present, the system SHALL rasterize the page and check that the rendered pixels inside the cover are uniform (per-channel standard deviation ≤ 8 on 0–255), which confirms the text is visually hidden.
12. WHEN a page has no text glyphs and at least one image covering ≥ 50% of the page THEN the system SHALL add the warning `pdf-scanned-page` with the page number, and SHALL add `unredacted-text` to `unchecked`.
13. The system SHALL check at most 2,000 pages and at most 2,000,000 operators per page. Beyond either limit it SHALL add the warning `pdf-limit-reached` and add `unredacted-text` to `unchecked`.

### Requirement 5: Prior revisions

**User Story:** As an editor who saved a cleaned-up PDF over an earlier draft, I want to know if the earlier draft is still inside the file, so that I can see what an incremental save kept.

#### Acceptance Criteria

1. WHEN the raw scanner finds N ≥ 2 revision boundaries THEN the system SHALL emit one `prior-revision` ghost for each of the first N − 1 boundaries. The final revision is the visible document, not a ghost.
2. Each prior-revision ghost SHALL have `location: { type: 'pdf-revision', index, start, end }`, where `index` counts from 0 (oldest first), `start` is the previous boundary (0 for the first revision) and `end` is the boundary. The prior document is `bytes.subarray(0, end)`.
3. WHILE fewer than 32 prior revisions have been analysed, the system SHALL open each prior prefix with pdf.js, compare it to the final revision page by page (page count, then normalized text content, then a hash of the operator list), and record the first page that differs.
4. WHERE the `rasterizePdfPage` and `encodeImage` adapters are present and a differing page was found, the system SHALL rasterize that page of the prior revision (the prefix bytes) at a scale whose width is ≤ 1,024 px, encode it as PNG, and attach it as `evidence.preview`.
5. The system SHALL include in `evidence.fields` the revision index, its byte range, `Pages then` and `Pages now`, the first differing page, and up to 500 characters of text present in the prior revision but absent from the final one (`Text removed since`).
6. The system SHALL set severity to `wraith` WHEN text was removed or page content changed; `shade` WHEN only the Info dictionary, XMP, annotations or form fields changed; and `wisp` WHEN the update only adds a digital signature (a `/Sig` field with `/ByteRange`).
7. The system SHALL set confidence to 0.95 for boundaries confirmed by the `/Prev` chain, and 0.7 otherwise.
8. IF a prior prefix cannot be opened by pdf.js THEN the system SHALL still emit the ghost, with no preview, confidence 0.6, and the warning `pdf-revision-unreadable` carrying the boundary as `offset`.

### Requirement 6: Document metadata

**User Story:** As someone publishing a PDF, I want to see the author, software and dates hidden in its metadata, so that I know what it says about me.

#### Acceptance Criteria

1. WHEN the Info dictionary has any non-empty entry THEN the system SHALL emit one `pdf-metadata` ghost whose `evidence.fields` lists every entry (standard and custom), with PDF dates shown as ISO 8601.
2. WHEN the document catalog has an XMP `/Metadata` stream THEN the system SHALL emit one `pdf-metadata` ghost for it, with fields for `dc:creator`, `dc:title`, `xmp:CreatorTool`, `pdf:Producer`, `xmp:CreateDate`, `xmp:ModifyDate`, `xmpMM:DocumentID`, `xmpMM:InstanceID` and each `xmpMM:History` event.
3. WHEN the raw scanner finds an uncompressed XMP packet outside the catalog metadata stream (for example in a page or image) THEN the system SHALL emit a `pdf-metadata` ghost titled "Stray XMP packet", with `location: { type: 'byte-range' }` set to the packet.
4. WHEN Info `/Author` or XMP `dc:creator` is non-empty THEN the system SHALL emit an `author-identity` ghost (severity `wraith`, confidence 0.95) with the name in `evidence.summary`.
5. The system SHALL set `pdf-metadata` severity to `shade` WHEN it contains a title, subject, keywords, dates, custom keys or a document ID, and `wisp` WHEN it contains only producer or creator-tool strings.
6. The system SHALL set metadata ghost locations to the byte range of the Info object or XMP stream when the raw scanner can find it, and otherwise to the byte range of the last trailer.
7. WHEN Info `/Creator` or `/Producer`, XMP `xmp:CreatorTool` or `pdf:Producer`, or any `xmpMM:History` event is non-empty THEN the system SHALL emit one `software-trail` ghost (severity `wisp`) listing them.
8. WHEN Info `/CreationDate` or `/ModDate`, or XMP `xmp:CreateDate`, `xmp:ModifyDate` or `xmp:MetadataDate` is present THEN the system SHALL emit one `capture-time` ghost (severity `wisp`) listing the dates in ISO 8601.
9. The derived ghosts (6.4, 6.7, 6.8) SHALL use the same location as the `pdf-metadata` ghost they come from. The `pdf-metadata` ghost stays the full record, and the exorcist removes the container.

### Requirement 7: Hidden annotations and comments

**User Story:** As a reviewer, I want to see comments and hidden annotations that a PDF viewer may not show, so that reviewers' notes and names don't leak.

#### Acceptance Criteria

1. The system SHALL read the annotations on every page and emit a `hidden-annotation` ghost for each annotation where any of these is true: the Invisible flag (bit 1), Hidden flag (bit 2) or NoView flag (bit 6) is set; the Print flag (bit 3) is clear on a non-widget annotation; or the annotation is a `Text` or `FreeText` annotation, the parent of a `Popup`, or any markup annotation with non-empty `/Contents` or `/T`.
2. The ghost SHALL have `location: { type: 'pdf-region', page, rect }` with the annotation rectangle, and `evidence.fields` SHALL include `Subtype`, `Flags` (named), `Author` (`/T`), `Contents`, `Modified` and `In reply to` when present.
3. The system SHALL set severity to `wraith` WHEN `/T` or `/Contents` is non-empty, and `shade` otherwise.
4. The system SHALL NOT also emit `author-identity` for annotation authors. The author appears only in the annotation ghost's fields.
5. WHEN the document has optional content groups that are off by default THEN the system SHALL add the warning `pdf-hidden-layer` naming the groups. Content in hidden layers is not reported as a ghost in v1.

### Requirement 8: Embedded files

**User Story:** As a person sharing a PDF, I want to know about attachments hidden inside it, so that I don't send a spreadsheet or photo by accident.

#### Acceptance Criteria

1. The system SHALL emit one `embedded-file` ghost for each entry in the `EmbeddedFiles` name tree and each `FileAttachment` annotation, removing duplicates by file name and content hash.
2. `evidence.fields` SHALL include `File name`, `Size`, `Description` and `Detected format` (from `formats/sniff.ts`).
3. WHEN the attachment's detected kind is `png` or `jpeg` and it is ≤ 4 MB THEN the system SHALL set `evidence.preview` to the attachment bytes, with width and height read from the PNG IHDR or JPEG SOFn header, without decoding pixels.
4. For each attachment of at most 64 MB, the system SHALL call `ctx.inspectNested(content, ctx)` (the orchestrator adds 1 to the depth and refuses depth 4). It SHALL emit `nestGhosts(inner, container)` for the inner ghosts, where `container` is this ghost's location, and SHALL add `Ghosts inside` (count and kinds) to the `embedded-file` ghost's fields. The orchestrator, not this extractor, copies nested warnings and adds `embedded-media-ghost` to `unchecked`.
5. The system SHALL set severity to `wraith` by default, and confidence to 1.0.
6. The location SHALL be `pdf-region` with the annotation rectangle for `FileAttachment` annotations, and the byte range of the embedded file stream object, when the raw scanner finds it, for name-tree entries (otherwise the byte range of the last trailer).

### Requirement 9: Encrypted, broken and unsupported PDFs

**User Story:** As a user, I want the app to tell me plainly what it could not check, so that I never mistake "could not open" for "clean" (G6).

#### Acceptance Criteria

1. IF pdf.js needs a password THEN the system SHALL add the warning `pdf-encrypted`, SHALL add `unredacted-text`, `pdf-metadata`, `author-identity`, `software-trail`, `capture-time`, `hidden-annotation`, `embedded-file` and `embedded-media-ghost` to `unchecked`, and SHALL still report `prior-revision` ghosts from the raw scanner, with no preview and confidence 0.7.
2. IF the file is encrypted but opens with an empty user password THEN the system SHALL run every check and add the warning `pdf-encrypted-owner-only`.
3. IF pdf.js fails to load the document for any other reason THEN the system SHALL add the warning `pdf-parse-failed` with the error message, SHALL add every pdf.js-dependent kind to `unchecked`, and SHALL return raw-scanner results.
4. IF one page fails to load or render THEN the system SHALL add the warning `pdf-page-failed` with the page number, continue with the remaining pages, and add the affected kinds to `unchecked`.
5. WHEN a page has no text glyphs but ≥ 200 filled path operators THEN the system SHALL add the warning `pdf-outline-text-possible` with the page number, and SHALL add `unredacted-text` to `unchecked`, because text converted to vector outlines cannot be read.
6. WHEN `rasterizePdfPage` (or, for previews, `encodeImage`) is absent THEN the system SHALL skip previews and pixel checks and add the warning `preview-unavailable` once.
