# Requirements Document

## Introduction

Exorcism produces a clean copy of a file and proves it is clean. This spec covers:

- the shared exorcism pipeline in `packages/core/src/orchestrator/exorcise.ts`: effective kinds, a private input copy, a call to the exorcist, a verification inspection, an optional second pass, banished accounting and warnings;
- the four v1 exorcists: PNG, JPEG, PDF and DOCX, where DOCX recurses into its embedded images through the image exorcists;
- output file naming (`<name>.clean.<ext>`).

The pipeline enforces three of the threat-model guarantees:
- **G2**: the original bytes are never mutated.
- **G3**: no ghost of a removed kind survives, checked by re-running every extractor on the output.
- **G6**: an incomplete clean is reported as incomplete, never as clean.

Shapes come from `packages/core/src/types.ts`: `Exorcist`, `ExorciseOptions`, `Exorcism`, `ExtractContext` and `PlatformAdapters`. Two additive type changes are proposed in design.md.

Definitions:
- **removes(X)** is `exorcist.removes` for format X.
- **E** (the effective kinds) is the set the pipeline asks the exorcist to remove (Requirement 4.1).
- **prior** is the inspection of the input.
- **verification** is the inspection of the output.
- **count_I(k)** is the number of ghosts of kind `k` in inspection `I`.

## Requirements

### Requirement 1: Exorcism pipeline and result shape

**User Story:** As a user, I want one "Exorcise" action that returns a clean file plus a list of what was banished, so that I know exactly what changed.

#### Acceptance Criteria

1. WHEN `exorcise(bytes, opts, run)` finds an exorcist THEN the system SHALL run these steps in order:
   1. obtain `prior`;
   2. compute `E`;
   3. call `exorcist.exorcise(copy, ctx, resolvedOpts)`;
   4. check the output kind;
   5. compute `verification = inspect(output)`;
   6. run the second pass (Requirement 2) if needed;
   7. compute `banished` and the pipeline warnings;
   8. resolve with an `Exorcism`.
2. IF `run.prior` is given with `size === bytes.byteLength` and `kind === sniff(bytes)` THEN the system SHALL use it as `prior`. Otherwise it SHALL compute `prior = inspect(bytes)` with the caller's signal and adapters.
3. `resolvedOpts` SHALL be `{ kinds: E, reencode: opts.reencode ?? true, rasterizeRedactions: opts.rasterizeRedactions ?? true }`.
4. IF the exorcist's output is non-empty and `sniff(output) !== sniff(bytes)` THEN the system SHALL discard the output and resolve as a failure (`ghost-model-and-ingest` criterion 5.4) with warning `output-kind-mismatch`.
5. `banished` SHALL list, in `GHOST_KINDS` order, one entry `{ kind: k, count: count_prior(k) }` for each `k ∈ E` where `count_prior(k) > 0` and `count_verification(k) = 0`. Kinds with a zero count SHALL NOT be listed.
6. WHEN a kind `k ∉ E` has `count_prior(k) > 0` and `count_verification(k) = 0` THEN the system SHALL add one warning `collateral-removal` listing every such kind. This happens, for example, when GPS and capture time share one Exif segment and only GPS was requested.
7. `Exorcism.warnings` SHALL contain the exorcist's warnings (from every pass, de-duplicated by code and message) followed by the pipeline's warnings.
8. The system SHALL export `summarizeExorcism(x: Exorcism): 'clean' | 'residual' | 'failed'`. It SHALL return:
   - `'failed'` iff `x.output.length === 0`;
   - `'residual'` iff a warning has code `ghost-survived` or `verification-incomplete`;
   - `'clean'` otherwise.

   The UI SHALL show "0 ghosts found in output" only for `'clean'`.
9. The exorcist phase SHALL have a budget of `clamp(ceil(6000 × size / MiB), 3000, 300000)` ms. Verification SHALL have its own budget computed from the output's size with the inspection formula. Both SHALL honour the caller's signal.

### Requirement 2: Post-exorcism verification (G3)

**User Story:** As a person about to send a "cleaned" file, I want the cleaner to prove its own work, so that I'm not trusting a promise.

#### Acceptance Criteria

1. `Exorcism.verification` SHALL be the `Inspection` of `output`, produced by the same registry, so it re-runs every extractor for the output's kind, including nested extractors.
2. IF any `k ∈ E` has `count_verification(k) > 0` after the first pass THEN the system SHALL run the exorcist once more on the first pass's output and re-verify. The system SHALL run at most 2 exorcist passes.
3. IF after the last pass any `k ∈ E` still has `count_verification(k) > 0` THEN the system SHALL add one warning `ghost-survived` per such kind, with the message `"<count> <kind> ghost(s) survived exorcism"`, and SHALL NOT list `k` in `banished`.
4. IF `verification.unchecked ∩ E ≠ ∅`, or verification carries a `budget-exceeded` or `aborted` warning THEN the system SHALL add warning `verification-incomplete` naming the unchecked kinds.
5. For every curse produced by the Paw for PNG, JPEG, PDF and DOCX, with default options and the reference Node adapters, `verification.ghosts` SHALL contain no ghost whose kind is in `E`, and there SHALL be no `ghost-survived` warning (G3).

### Requirement 3: Original untouched (G2)

**User Story:** As a user, I want my original file left exactly as it was, so that a bug in cleaning can never destroy it.

#### Acceptance Criteria

1. WHEN `exorcise(bytes, …)` resolves or is aborted THEN `bytes` SHALL be byte-for-byte equal to its value before the call.
2. The pipeline SHALL pass the exorcist a private copy (`bytes.slice()`). Every exorcist SHALL also, on its own, not mutate the array it receives. This SHALL be tested directly, without the copy.
3. `output.buffer` SHALL NOT be `bytes.buffer`, and writing to `output` SHALL NOT change `bytes`.
4. In the web app, the clean file SHALL be offered as a new `Blob` download named per Requirement 15. The dropped `File` SHALL NOT be modified or replaced.

### Requirement 4: Option semantics

**User Story:** As a power user, I want to choose which ghosts to remove and how, so that I can keep, say, the capture time while removing GPS.

#### Acceptance Criteria

1. The system SHALL compute `E = (opts.kinds ?? removes(X)) ∩ removes(X)`. WHEN `rasterizeRedactions === false` THEN it SHALL also remove `unredacted-text` from `E`.
2. IF `opts.kinds` contains a kind not in `removes(X)` THEN the system SHALL add warning `kind-not-removable` listing those kinds.
3. IF `rasterizeRedactions === false` and the prior contains `unredacted-text` ghosts THEN the system SHALL add warning `redactions-not-flattened`.
4. IF `E` is empty THEN the system SHALL NOT call the exorcist. It SHALL resolve with `output = bytes.slice()`, `banished = []`, warning `nothing-to-remove` and `verification = inspect(output)`.
5. IF `opts` fails `ExorciseOptionsSchema` (for example an unknown kind string from untyped callers) THEN the system SHALL resolve as a failure with warning `invalid-option`.

### Requirement 5: PNG exorcist

**User Story:** As someone posting a screenshot, I want the clean PNG to look identical but carry nothing else, so that cropping really crops.

#### Acceptance Criteria

1. `removes(png)` SHALL be: `trailing-data`, `recovered-image`, `embedded-thumbnail`, `gps-location`, `device-identity`, `software-trail`, `capture-time`, `author-identity`, `icc-profile-identity`.
2. WHEN `reencode` is true, `E = removes(png)`, `adapters.decodeImage` and `adapters.encodeImage` exist, and the file is not APNG (no `acTL`) THEN the exorcist SHALL decode to RGBA, encode a new PNG, and then chunk-strip the encoder's output with the allowlist (5.3). This also removes data hidden inside the IDAT stream after the zlib end.
3. WHEN the exorcist chunk-strips (`reencode` false, adapters missing, APNG, or after a re-encode) and `E = removes(png)` THEN it SHALL copy only chunks whose type is in the allowlist:
   - `IHDR`, `PLTE`, `IDAT`, `IEND`;
   - `tRNS`, `gAMA`, `cHRM`, `sRGB`, `sBIT`, `pHYs`, `bKGD`, `hIST`;
   - `cICP`, `mDCV`, `cLLI`;
   - `acTL`, `fcTL`, `fdAT`;
   - `iCCP` only when its profile is standard (image-ghosts Requirement 10.3).

   The exorcist SHALL copy each chunk byte-for-byte, keeping its original CRC, and SHALL write nothing after `IEND`.
4. WHEN `E` is a strict subset of `removes(png)` THEN the exorcist SHALL drop exactly:
   - each chunk that contains the start offset of a ghost whose kind is in `E`, as found by calling the PNG extractor's `extract` directly;
   - the trailing bytes, when `trailing-data` or `recovered-image` is in `E`.

   It SHALL keep every other chunk.
5. WHEN a re-encode is skipped because adapters are missing, the file is APNG, or `E` is a strict subset (re-encoding would destroy kinds the user chose to keep) THEN the exorcist SHALL add warning `reencode-unavailable`, `apng-chunk-strip` or `reencode-skipped-subset`, respectively.
6. WHEN a non-standard `iCCP` is dropped THEN the exorcist SHALL add warning `icc-dropped` ("colours may shift slightly"). WHEN a re-encode reduces bit depth (16 to 8) or turns a palette into RGBA THEN it SHALL add warning `bit-depth-reduced` or `palette-expanded`.
7. IF IHDR is missing or the walker stops before IEND THEN the exorcist SHALL resolve with empty output and warning `png-unrepairable`. It SHALL NOT emit a partial image.

### Requirement 6: JPEG exorcist

**User Story:** As a seller posting a product photo, I want location and camera data removed without the photo turning sideways, so that the clean copy is usable.

#### Acceptance Criteria

1. `removes(jpeg)` SHALL equal `removes(png)`.
2. WHEN `reencode` is true, `E = removes(jpeg)` and both adapters exist THEN the exorcist SHALL decode to display-oriented RGBA (EXIF Orientation `0x0112` applied, per the adapter contract), encode a JPEG at quality 0.92, and segment-strip the result with the allowlist (6.3).
3. WHEN the exorcist segment-strips with `E = removes(jpeg)` THEN it SHALL keep:
   - SOI;
   - APP0 `JFIF` only, rewritten as a 14-byte payload (`JFIF\0`, version, units, densities; length field `0x0010`) with `Xthumbnail = Ythumbnail = 0` and no thumbnail data;
   - APP14 `Adobe`;
   - APP2 `ICC_PROFILE` only when the reassembled profile is standard;
   - DQT, SOFn, DHT, DAC and DRI;
   - every SOS with its entropy-coded data (RSTn included);
   - DNL and EOI.

   It SHALL drop every other segment (APP1 Exif/XMP/ExtendedXMP, APP2 MPF, APP3–APP13, APP15, JFXX, COM) and every byte after EOI.
4. IF the input's Orientation is in `2..8` and Exif is being dropped THEN the exorcist SHALL insert, right after SOI (and after the JFIF APP0 when it is kept), the 36-byte segment (length field `0x0022`) `FF E1 00 22 45 78 69 66 00 00 4D 4D 00 2A 00 00 00 08 00 01 01 12 00 03 00 00 00 01 00 0n 00 00 00 00 00 00`, where `0n` is the orientation value. That is a big-endian TIFF with one IFD0 entry and next-IFD offset 0. The image-ghosts mappers SHALL report no ghost for this segment.
5. WHEN `E` is a strict subset THEN segment-level removal SHALL follow the PNG rules in 5.4 and 5.5, at segment granularity. The ExtendedXMP segments SHALL go with their main XMP segment, and every APP2 ICC segment SHALL be removed together.
6. WHEN MPF secondary images (gain maps, depth maps) are dropped THEN the exorcist SHALL add warning `mpf-secondary-dropped` ("HDR or portrait data removed").
7. IF there is no SOS or no EOI THEN the exorcist SHALL resolve with empty output and warning `jpeg-unrepairable`.

### Requirement 7: PDF metadata removal

**User Story:** As a paralegal, I want the author, software and dates removed from a PDF, so that the document doesn't say who prepared it or when.

#### Acceptance Criteria

1. `removes(pdf)` SHALL be: `pdf-metadata`, `author-identity`, `software-trail`, `capture-time`, `prior-revision`, `unredacted-text`, `hidden-annotation`, `embedded-file`.
2. The exorcist SHALL load the document with `pdf-lib` using `{ updateMetadata: false, throwOnInvalidObject: false }`, so pdf-lib does not write its own Producer or ModDate.
3. WHEN any of `pdf-metadata`, `author-identity`, `software-trail` or `capture-time` is in `E` THEN the exorcist SHALL remove:
   - the trailer's `/Info` and `/ID` (ISO 32000-2 §14.3.3 and §14.4);
   - the catalog's `/Metadata` XMP stream (§14.3.2);
   - `/Metadata` from every page, form XObject, image XObject and font dictionary;
   - `/PieceInfo` (§14.5) from the catalog, pages and form XObjects;
   - `/LastModified` from the catalog and pages;
   - `/M` from every kept annotation.
4. IF the document is encrypted THEN the exorcist SHALL resolve with empty output and warning `pdf-encrypted`.
5. WHEN the catalog has `/AcroForm` with `/SigFlags` bit 1 set, or any field with `/FT /Sig` and a `/V` THEN the exorcist SHALL add warning `signature-invalidated`.

### Requirement 8: PDF prior revisions

**User Story:** As an HR officer who edited a PDF, I want earlier versions removed, so that a deleted salary figure can't be recovered from an incremental save.

#### Acceptance Criteria

1. The exorcist SHALL always write the output as one full rewrite with `pdf-lib` `save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })`. This produces a single classic cross-reference section and a single trailer (ISO 32000-2 §7.5.6 incremental updates are not kept).
2. Before saving, the exorcist SHALL garbage-collect the object graph. It SHALL compute the set of objects reachable from the trailer `/Root` (with `/Info` and `/ID` already removed) by following references in dictionaries, arrays and stream dictionaries, and SHALL delete every unreachable indirect object from the pdf-lib context. Objects from earlier revisions, replaced content streams and the linearization dictionary are therefore not written.
3. The output SHALL contain exactly one `startxref` keyword and SHALL end with `%%EOF` followed by at most one end-of-line marker.

### Requirement 9: PDF redactions that only cover text

**User Story:** As a newsroom editor, I want text that sits under black boxes destroyed, not just hidden, so that copy-paste can't reveal it.

#### Acceptance Criteria

1. WHEN `unredacted-text ∈ E` THEN the exorcist SHALL find the pages with bad redactions by calling the PDF extractor's `extract` directly (pdf-ghosts spec) and collecting the 1-based `page` of every `unredacted-text` ghost's `pdf-region` location. Each such page SHALL be rasterized with `adapters.rasterizePdfPage(copyOf(bytes), page, { scale, signal })`.
2. The scale SHALL be `200 / 72` (200 DPI), reduced so that `width × height ≤ 25,000,000` pixels. The render SHALL apply the page `/Rotate` and the CropBox, and SHALL draw only annotations that are neither Hidden nor NoView.
3. The exorcist SHALL replace each rasterized page at the same index with a new page whose MediaBox matches the rendered CropBox size in points (rotation already applied, `/Rotate` 0) and whose only content is the image drawn full-page, embedded as PNG. The old page's content streams, resources and annotations SHALL become unreachable and be collected under 8.2.
4. The exorcist SHALL add warning `page-rasterized` listing the 1-based page numbers, and explaining that text on those pages is no longer selectable and links on them are gone.
5. IF `rasterizePdfPage` is missing, or fails for a page THEN the exorcist SHALL leave that page unchanged and add warning `rasterize-unavailable` with the page numbers. The verification (Requirement 2) SHALL then report the surviving ghost as `ghost-survived`.

### Requirement 10: PDF hidden annotations and embedded files

**User Story:** As a lawyer, I want reviewer comments and attachments removed from a PDF before filing, so that internal notes don't go to the other side.

#### Acceptance Criteria

1. WHEN `hidden-annotation ∈ E` THEN the exorcist SHALL remove from every page's `/Annots` each annotation whose `/Subtype` is not `/Link` or `/Widget`, and each annotation whose `/F` has Hidden (bit 2, value 2) or NoView (bit 6, value 32) set (ISO 32000-2 §12.5.3). It SHALL also remove any `/Popup` references, and SHALL drop `/Annots` when it becomes empty.
2. WHEN a removed annotation is a widget THEN the exorcist SHALL remove it from its field's `/Kids`, and SHALL remove from `/AcroForm /Fields` (recursively) any field that is left with no widgets.
3. WHEN `embedded-file ∈ E` THEN the exorcist SHALL remove `/Names /EmbeddedFiles` (§7.7.4), dropping `/Names` when it becomes empty, plus `/AF` (§14.13) on the catalog, pages and annotations, `/Collection` (portfolios), and every `/FileAttachment` annotation.
4. The exorcist SHALL keep the document's page count, page order, and the visible page sizes of pages that were not rasterized.

### Requirement 11: DOCX tracked changes

**User Story:** As a contract manager, I want tracked changes resolved before sending, so that the other party sees the final text and not our negotiation history.

#### Acceptance Criteria

1. `removes(docx)` SHALL be: `tracked-change`, `comment`, `revision-id`, `docx-properties`, `author-identity`, `embedded-media-ghost`.
2. WHEN `tracked-change ∈ E` THEN the exorcist SHALL accept all revisions in every `word/**/*.xml` part, following ECMA-376-1 §17.13.5:
   - unwrap `w:ins` and `w:moveTo`, keeping their children in place;
   - remove `w:del` and `w:moveFrom` with all their content;
   - remove `w:moveFromRangeStart`, `w:moveFromRangeEnd`, `w:moveToRangeStart` and `w:moveToRangeEnd`;
   - remove `w:rPrChange`, `w:pPrChange`, `w:sectPrChange`, `w:tblPrChange`, `w:tblPrExChange`, `w:trPrChange`, `w:tcPrChange`, `w:tblGridChange` and `w:numberingChange`. This keeps the current formatting.
3. WHEN a paragraph's mark is marked deleted (`w:p/w:pPr/w:rPr/w:del`) and a following sibling `w:p` exists in the same parent THEN the exorcist SHALL merge the two:
   - append the next paragraph's children except its `w:pPr` to this paragraph;
   - give this paragraph the next paragraph's `w:pPr`, because the surviving mark is the next one;
   - remove the next paragraph;
   - repeat while the new mark is also deleted.

   IF there is no following paragraph THEN the exorcist SHALL remove only the marker. A paragraph-mark `w:ins` marker SHALL be removed.
4. WHEN a table row is marked deleted (`w:trPr/w:del`) THEN the exorcist SHALL remove the `w:tr`. WHEN a cell is marked deleted (`w:tcPr/w:cellDel`) THEN it SHALL remove the `w:tc` and add warning `cell-deletion-accepted`. The markers `w:trPr/w:ins`, `w:tcPr/w:cellIns` and `w:tcPr/w:cellMerge` SHALL be removed, and `w:cellMerge` SHALL also add warning `cell-merge-accepted`.
5. The exorcist SHALL remove `w:trackRevisions` from `word/settings.xml`, so that the clean file does not resume recording names.
6. WHEN `author-identity ∈ E` and `tracked-change ∉ E` THEN the exorcist SHALL keep the revisions but set `w:author="Author"` and remove `w:date`, `w:initials` and `w16du:dateUtc` on every revision element and `w:comment`. In `word/people.xml` it SHALL set each `w15:person/@w15:author` to `Author` and remove `w15:presenceInfo`.

### Requirement 12: DOCX comments

**User Story:** As an editor, I want every comment and its author gone, so that reviewer chatter doesn't leave the building.

#### Acceptance Criteria

1. WHEN `comment ∈ E` THEN the exorcist SHALL delete the parts `word/comments.xml`, `word/commentsExtended.xml`, `word/commentsIds.xml` and `word/commentsExtensible.xml`, and also `word/people.xml` when `tracked-change ∈ E` or `author-identity ∈ E`.
2. The exorcist SHALL remove `w:commentRangeStart`, `w:commentRangeEnd` and `w:commentReference` from every part. It SHALL remove any `w:r` left with no children other than `w:rPr`.
3. For every deleted part, the exorcist SHALL remove its relationship from the owning `.rels` part and its `Override` from `[Content_Types].xml` (ECMA-376-2 OPC).

### Requirement 13: DOCX revision ids and document properties

**User Story:** As a whistleblower, I want the hidden session ids and document properties removed, so that two versions of a document can't be linked to my machine.

#### Acceptance Criteria

1. WHEN `revision-id ∈ E` THEN the exorcist SHALL:
   - remove, in every `word/**/*.xml` part, every attribute in the `w` namespace (`http://schemas.openxmlformats.org/wordprocessingml/2006/main`) whose local name starts with `rsid`;
   - remove `w:rsids` from `word/settings.xml`;
   - remove `w14:paraId` and `w14:textId` once `word/commentsExtended.xml` is gone or absent.

   Namespace declarations and `mc:Ignorable` SHALL be kept unchanged.
2. WHEN `docx-properties ∈ E` THEN the exorcist SHALL:
   - delete `docProps/core.xml`, `docProps/app.xml`, `docProps/custom.xml` and any `docProps/thumbnail.*`;
   - remove their relationships from `_rels/.rels` and their content-type overrides;
   - remove `w:attachedTemplate` from `word/settings.xml` along with its relationship in `word/_rels/settings.xml.rels`.
3. The output ZIP SHALL:
   - keep the original entry order;
   - set every entry's DOS modification date and time to 1980-01-01 00:00:00 (date `0x0021`, time `0x0000`);
   - have no archive comment;
   - have no extended-timestamp (`0x5455`) or NTFS (`0x000A`) extra fields;
   - use DEFLATE level 6 for entries that were deflated and STORE for entries that were stored.
4. The output package SHALL stay OPC-consistent:
   - every internal relationship target exists;
   - every `Override` names an existing part;
   - every part other than `.rels` and `[Content_Types].xml` has a content type through `Default` or `Override`.
5. Every rewritten XML part SHALL keep its original XML declaration. It SHALL be parsed and serialized with `@xmldom/xmldom`, because `DOMParser` is not available in Web Workers.
6. IF the docx-ghosts proposed kinds `hidden-text` and `alt-text` are added to `types.ts` THEN `removes(docx)` SHALL include them. For `hidden-text`, the exorcist SHALL remove every `w:r` whose effective run properties set `w:vanish` (directly or through its character or paragraph style) and every `w:specVanish` marker. For `alt-text`, it SHALL remove the `descr` and `title` attributes from `wp:docPr` and `pic:cNvPr`, and `alt` from VML `v:shape`.

### Requirement 14: DOCX embedded media

**User Story:** As someone sharing a report with photos, I want the photos inside the document cleaned too, so that one embedded JPEG doesn't leak my location.

#### Acceptance Criteria

1. WHEN `embedded-media-ghost ∈ E` THEN the exorcist SHALL handle every entry under `word/media/` as follows. IF its sniffed kind has an exorcist THEN the exorcist SHALL clean the entry with `ctx.exorciseNested(entryBytes, ctx, { reencode: opts.reencode })` (depth + 1, maximum 3, shared signal), and SHALL replace the entry's bytes when the nested output is non-empty and has the same kind.
2. Entry names, relationship ids and content types of media SHALL be unchanged.
3. IF a media entry's kind has no exorcist (GIF, EMF, WMF, TIFF, SVG, HEIC) THEN the exorcist SHALL keep it and add warning `media-unsupported` with its path. IF a nested exorcism fails THEN the exorcist SHALL keep the original entry and add warning `media-exorcism-failed` with its path.
4. WHEN `word/embeddings/` entries (OLE objects) exist THEN the exorcist SHALL keep them and add warning `embedding-unchecked`. WHEN `word/vbaProject.bin` exists THEN it SHALL add `macros-present`. WHEN `customXml/` parts exist THEN it SHALL add `customxml-present`.

### Requirement 15: Output file naming

**User Story:** As a user, I want the clean file named so I can tell it from the original at a glance, so that I never send the wrong one.

#### Acceptance Criteria

1. The system SHALL export `cleanFileName(original: string, kind: FileKind): string` from `packages/core/src/naming.ts`. It SHALL return `<stem>.clean.<ext>`.
2. The system SHALL compute the stem as follows:
   1. take the part after the last `/` or `\`;
   2. replace each U+0000–U+001F, U+007F and `<>:"|?*` with `_`;
   3. remove the last extension, meaning the text after the final `.` when that dot is not the first character;
   4. trim trailing dots and spaces;
   5. IF the stem ends with `.clean` (case-insensitive) THEN remove that suffix, so the marker is never doubled;
   6. IF the stem is empty THEN use `file`.
3. The extension SHALL be the original extension (case preserved) when its lowercase form is valid for `kind`: `png`; `jpg`, `jpeg`, `jpe`, `jfif`; `heic`, `heif`; `pdf`; `docx`, `docm`. Otherwise it SHALL be the canonical extension: `png`, `jpg`, `heic`, `pdf`, `docx`.
4. The result SHALL be at most 255 bytes of UTF-8. The stem SHALL be truncated at a code-point boundary to fit.
5. `cleanFileName` SHALL be idempotent: `cleanFileName(cleanFileName(n, k), k) === cleanFileName(n, k)`.

### Requirement 16: Failure modes and honesty

**User Story:** As a user, I want a clear "couldn't clean this" instead of a broken or half-clean file, so that I never share something I wrongly think is safe (G6).

#### Acceptance Criteria

1. The exorcists SHALL never throw. Any thrown error inside an exorcist SHALL become a failure result (empty output) with warning `exorcism-failed`. This is caught by the orchestrator, per `ghost-model-and-ingest` criterion 5.4.
2. IF the input kind is `heic` THEN `exorcise` SHALL resolve with `no-exorcist` in v1, and the UI SHALL offer "Convert to JPEG and exorcise" only when `decodeImage` supports `image/heic`.
3. WHEN the result is `'residual'` THEN the UI SHALL list every surviving ghost from `verification` and SHALL label the download "Partly cleaned". It SHALL NOT use the teal "banished" check.
4. Exorcist warnings SHALL follow the message rules in `ghost-model-and-ingest` criterion 5.5.
