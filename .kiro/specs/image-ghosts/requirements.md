# Requirements Document

## Introduction

This spec defines the PNG, JPEG and HEIC extractors (`packages/core/src/extractors/{png,jpeg,heic}/`). They find the ghosts that images carry:

- bytes after the end-of-image marker, including aCropalypse tails (CVE-2023-21036 Google Pixel Markup, CVE-2023-28303 Windows Snipping Tool), with best-effort reconstruction of the cropped-away pixels;
- EXIF, XMP and IPTC metadata (GPS, device serial numbers, software history, capture time, author names);
- embedded thumbnails that may predate a crop;
- ICC profile descriptions that name a device or person;
- PNG `tEXt`, `zTXt` and `iTXt` text chunks.

It also defines the severity rules for these ghosts and how GPS is displayed: coordinates plus an offline place name from a bundled gazetteer, and map tiles only after an explicit opt-in click (threat model, "Opt-in network exception").

Every extractor implements `Extractor` from `types.ts`, never throws, and reports through the orchestrator defined in the `ghost-model-and-ingest` spec. Offsets are always absolute file offsets.

Format references:
- PNG: W3C PNG Specification (Third Edition), §5 datastream structure and §11 chunk specifications; ISO/IEC 15948.
- zlib and deflate: RFC 1950 and RFC 1951.
- JPEG: ITU-T T.81 Annex B; JFIF 1.02.
- Exif: CIPA DC-008 (Exif 2.32 and 3.0).
- MPF: CIPA DC-007.
- XMP: ISO 16684-1, plus the Adobe XMP Part 3 JPEG/PNG embedding rules.
- IPTC: IIM 4.2.
- ICC: ICC.1:2022.
- HEIF: ISO/IEC 23008-12 on ISOBMFF (ISO/IEC 14496-12).

## Requirements

### Requirement 1: PNG chunk walker

**User Story:** As an extractor author, I want a small, fully tested PNG chunk walker, so that every PNG ghost is located by exact chunk offsets.

#### Acceptance Criteria

1. The system SHALL provide `walkPng(bytes, signal?)`. It SHALL return each chunk as `{ type, start, dataStart, dataEnd, end, crcOk }`, where `start` is the offset of the 4-byte length field, `dataStart = start + 8`, `dataEnd = dataStart + length`, and `end = dataEnd + 4` (CRC-32 over type and data, ISO 3309).
2. The walker SHALL begin at offset 8, after the PNG signature, and SHALL stop after the first `IEND` chunk. It SHALL report `iendEnd` as that chunk's `end`.
3. IF a chunk's length is greater than 2³¹−1 or its `end` is past `byteLength` THEN the walker SHALL stop, emit warning `png-truncated` at offset `start`, and report `iendEnd = undefined`.
4. IF a chunk type byte is not an ASCII letter (`41–5A` or `61–7A`) THEN the walker SHALL stop with warning `png-bad-chunk-type` at that offset.
5. IF a CRC does not match THEN the walker SHALL set `crcOk = false`, emit warning `png-bad-crc` (at most 10 such warnings, then one `png-bad-crc-more` with a count), and continue.
6. IF the first chunk is not `IHDR` (13-byte data: width, height, bit depth, colour type, compression, filter, interlace) THEN the walker SHALL emit warning `png-ihdr-not-first` and continue.
7. The walker SHALL check `signal.aborted` at least every 1,024 chunks.

### Requirement 2: Trailing data after PNG IEND and JPEG EOI

**User Story:** As someone posting a cropped screenshot, I want to know if the file still holds bytes past its visible end, so that I don't publish the part I cropped out.

#### Acceptance Criteria

1. WHEN a PNG's `iendEnd < byteLength`, or a JPEG's primary-image EOI end `eoiEnd < byteLength`, THEN the extractor SHALL report exactly one `trailing-data` ghost with `location = { type: 'byte-range', start: iendEnd | eoiEnd, end: byteLength }` and `confidence = 1`.
2. IF `iendEnd`/`eoiEnd` is undefined (no end marker found) THEN the extractor SHALL NOT report `trailing-data`. It SHALL emit warning `no-end-marker` and add `trailing-data` and `recovered-image` to `unchecked`.
3. The extractor SHALL classify the trailing bytes `t` as the first matching class in this order:
   - `png-idat-tail`: `t` contains a CRC-valid `IDAT` chunk header, or ends with `00 00 00 00 49 45 4E 44 AE 42 60 82`.
   - `embedded-file`: `sniff` of `t`, or of `t` from its first `89 50 4E 47 0D 0A 1A 0A` / `FF D8 FF` / `%PDF-` / `50 4B 03 04` at offset ≤ 64, is not `unknown`.
   - `mpf`: JPEG only; the ranges covered by MPF entries (Requirement 4.5) cover ≥ 99% of `t`.
   - `jpeg-entropy-tail`: JPEG only; `t` ends with `FF D9` and contains no `FF D8 FF`.
   - `samsung-sef`: `t` ends with the ASCII `SEFT`.
   - `zeros`: every byte is `00`.
   - `unknown`.
4. The ghost's severity SHALL be: `wraith` for `png-idat-tail`, `jpeg-entropy-tail` and `embedded-file`; `shade` for `samsung-sef`, and for `unknown` when `len(t) ≥ 16`; `wisp` for `mpf`, `zeros`, and `unknown` when `len(t) < 16`. WHEN the trailing bytes are inspected as nested content (2.6) THEN the severity SHALL be raised to the highest severity among the nested ghosts.
5. The ghost's evidence SHALL include fields `Bytes` (decimal count), `Starts at` (`0x` + 8 hex digits) and `Looks like` (the class label in plain words, such as "the end of a larger PNG (aCropalypse pattern)"). `evidence.raw` SHALL be `{ class, length }`.
6. WHEN the class is `embedded-file` THEN the extractor SHALL call `ctx.inspectNested` on the embedded bytes and report the result through `nestGhosts`, with `container` set to the trailing byte range.
7. Metadata parsing (Requirements 5–10) SHALL read only the bytes before `iendEnd`/`eoiEnd`. Metadata inside the trailing bytes is reported only through 2.6.

### Requirement 3: aCropalypse reconstruction (PNG)

**User Story:** As a journalist checking a source's screenshot, I want to see the pixels that were cropped away, so that I understand exactly what the file would reveal.

#### Acceptance Criteria

1. WHEN the class is `png-idat-tail` THEN the extractor SHALL try reconstruction with `recoverPngTail(tail, hints, signal)`. `hints` SHALL hold the visible image's IHDR (width, height, bit depth, colour type) and its PLTE, if present.
2. The system SHALL rebuild the tail's deflate bytes as follows. Find every CRC-valid `len‖"IDAT"` header in the tail. The first fragment is `tail[0, h₀ − 4)`, where `h₀` is the first header offset and the 4 dropped bytes are the CRC of the original, partly overwritten chunk. Each later fragment is the data of one complete IDAT chunk. IF there is no IDAT header THEN the stream is `tail[0, len − 16)`, dropping the original chunk's CRC and the 12-byte IEND.
3. The system SHALL search bit offsets `b ∈ [0, 8 · min(len(stream), 262144))` for a deflate block start (RFC 1951 §3.2.3). A candidate SHALL be rejected unless all of the following hold:
   - `BTYPE ≠ 11`;
   - for stored blocks, the stream is byte-aligned after the header and `LEN = ~NLEN`;
   - for dynamic blocks, `HLIT ≤ 286`, `HDIST ≤ 30`, the code-length code is neither over-subscribed nor incomplete, the literal/length code gives symbol 256 a non-zero length, and both trees are complete (or the single-code distance case);
   - full decoding from `b` reaches a block with `BFINAL = 1` that ends within the last 8 bytes of the stream.

   At most 64 candidates SHALL be fully decoded. The first one accepted SHALL win.
4. Decoding SHALL start with a 32,768-byte window of unknown bytes. It SHALL track a known/unknown flag for every output byte, and a back-reference that copies an unknown byte SHALL produce an unknown byte.
5. The system SHALL align scanlines from the end of the decoded data, because the original stream ends exactly at the last byte of the last row. For each candidate `(width, bytesPerPixel)`, the stride is `s = 1 + ⌈width · bitsPerPixel / 8⌉`, rows are `k = ⌊D / s⌋`, and the score is the fraction of known filter bytes (at offsets `D − (j+1)·s` for `j ∈ [0, k)`) whose value is ≤ 4.
   - Width candidates: the visible IHDR width, the visible IHDR height, and the bundled list of common screen widths (design.md).
   - Bits-per-pixel candidates: the visible image's, plus 24 and 32.

   The best-scoring candidate SHALL be accepted only if `score ≥ 0.98` and `k ≥ 2`. Ties SHALL be broken in favour of the visible width.
6. The system SHALL unfilter rows using PNG filter types 0–4 (None, Sub, Up, Average, Paeth). A reconstructed byte SHALL be known only when its filtered byte and every byte its predictor reads are known.
7. WHEN reconstruction succeeds THEN the extractor SHALL report one `recovered-image` ghost with:
   - `location` equal to the trailing range;
   - `evidence.preview` as an RGBA PNG of the recovered rows, with unknown pixels at alpha 0, downscaled with a box filter to ≤ 1024 px on the longest side (≤ 512 px when `adapters.encodeImage` is missing and the built-in stored-deflate encoder is used);
   - `evidence.fields` `Original width (guessed)`, `Recovered rows`, `Known pixels` (percent, one decimal) and `Deflate bit offset`;
   - `evidence.raw` as `{ width, bitsPerPixel, rows, knownRatio, bitOffset }`.
8. The confidence SHALL be `min(0.95, 0.55 + 0.4 · knownRatio)` when `score ≥ 0.98`. Severity SHALL be `revenant` when confidence ≥ 0.6, otherwise `wraith`.
9. IF reconstruction fails (no block start, no width candidate, interlaced original suspected, aborted, or decompression limit) THEN the extractor SHALL keep the `trailing-data` ghost, emit warning `acropalypse-unrecoverable` with the reason, and add `recovered-image` to `unchecked`.
10. WHEN the class is `embedded-file` and the embedded file is a PNG or JPEG THEN the extractor SHALL report a `recovered-image` ghost whose preview is those bytes (decoded dimensions from IHDR or SOFn), with confidence 0.9 and severity `revenant`.
11. WHEN the JPEG class is `jpeg-entropy-tail` THEN the extractor SHALL NOT attempt pixel recovery in v1. It SHALL add `recovered-image` to `unchecked` and emit warning `jpeg-tail-not-reconstructed`.
12. Reconstruction SHALL charge every decoded byte to the decompression meter (64 MiB per stream) and SHALL check `signal.aborted` at least every 64 KiB of output.

### Requirement 4: JPEG segment walker

**User Story:** As an extractor author, I want a JPEG segment walker that copes with real-world files, so that metadata segments, thumbnails and the end of the image are located exactly.

#### Acceptance Criteria

1. The system SHALL provide `walkJpeg(bytes, signal?)`. It SHALL return segments `{ marker, start, payloadStart, end, label }`, starting from SOI `FF D8`. Each segment SHALL be read from its 2-byte big-endian length, which includes the length field itself. Standalone markers (`FF 01`, `FF D0–D7`) SHALL have no length.
2. After each SOS (`FF DA`) header, the walker SHALL scan entropy-coded data. `FF 00` (stuffing), `FF D0–FF D7` (RSTn) and fill bytes `FF FF` SHALL continue the scan. Any other `FF xx` SHALL start the next marker. This SHALL support progressive files with several scans.
3. The primary image SHALL end at the first EOI (`FF D9`) reached at the top level, so EOIs inside APP segments (for example the Exif thumbnail) are skipped by segment length. The walker SHALL report `eoiEnd`.
4. The walker SHALL label APP segments by identifier:
   - APP0 `JFIF\0` → `JFIF`; APP0 `JFXX\0` → `JFXX`
   - APP1 `Exif\0\0` → `Exif`; APP1 `http://ns.adobe.com/xap/1.0/\0` → `XMP`; APP1 `http://ns.adobe.com/xmp/extension/\0` → `ExtendedXMP`
   - APP2 `ICC_PROFILE\0` → `ICC`; APP2 `MPF\0` → `MPF`
   - APP13 `Photoshop 3.0\0` → `IRB`
   - APP14 `Adobe` → `Adobe`
   - `FF FE` → `COM`
   - anything else → `APPn`
5. WHEN an `MPF` segment exists THEN the system SHALL parse its MP Index IFD (tag `0xB002` MP Entry, 16 bytes per entry). It SHALL turn each non-primary entry's offset, which is relative to the MPF TIFF header at `payloadStart + 4`, into an absolute byte range.
6. IF a length runs past `byteLength`, or a non-`FF` byte appears where a marker is expected THEN the walker SHALL emit `jpeg-truncated` or `jpeg-garbage` (searching forward at most 64 KiB for the next `FF`) and return what it has.
7. WHEN a `COM` segment contains non-whitespace text THEN the extractor SHALL report a `software-trail` ghost (title "JPEG comment") with the first 500 characters as evidence. Severity SHALL be `wisp` if the text matches a known encoder banner (for example `^CREATOR: gd-jpeg`, `^Created with GIMP`, `^LEAD Technologies`), otherwise `shade`.

### Requirement 5: Metadata parsing via exifr and the XMP reader

**User Story:** As a maintainer, I want metadata read with one pinned library and one small XMP reader, so that tag mapping is precise and the same for JPEG, PNG and HEIC.

#### Acceptance Criteria

1. The system SHALL parse TIFF/Exif (IFD0, Exif IFD via `0x8769`, GPS IFD via `0x8825`, IFD1) and IPTC with `exifr` (version pinned in `package.json`), imported dynamically inside `extract`. It SHALL call exifr with `translateKeys: false`, `translateValues: false`, `reviveValues: false`, `mergeOutput: false`, `makerNote: false`, `icc: false`, `xmp: false`, so that the mapping uses numeric tag ids.
2. The input SHALL be: for JPEG, `bytes.subarray(0, eoiEnd)`; for PNG, the payload of an `eXIf` chunk (a TIFF stream starting `II*\0` or `MM\0*`) and any decoded "Raw profile type exif/APP1" text chunk; for HEIC, the whole file.
3. The system SHALL read XMP with its own reader, `xmp/read.ts`, because `DOMParser` is not available in Web Workers. The reader SHALL:
   - resolve properties by namespace URI, not by prefix;
   - support both attribute form and element form, and `rdf:Seq`/`rdf:Bag`/`rdf:Alt` lists;
   - for JPEG, join ExtendedXMP chunks by GUID and offset (Adobe XMP Part 3 §1.1.3.1).
4. The system SHALL group findings into at most one ghost per ghost kind per source container (one `Exif` segment, one `XMP` packet, one IPTC block, one PNG text chunk). Every contributing tag SHALL be listed in `evidence.fields`, as `"<Tag name> (0x<id>)"` for Exif tags or `"<prefix>:<Name>"` for XMP.
5. Each metadata ghost's `location` SHALL be `{ type: 'chunk', name, start, end }`, covering the whole source container. `name` is one of `APP1/Exif`, `APP1/XMP`, `APP1/ExtendedXMP`, `APP13/IPTC`, `eXIf`, `iTXt/XML:com.adobe.xmp`, `tEXt/<keyword>`, `zTXt/<keyword>`, `iTXt/<keyword>`, `heic/Exif`, `heic/XMP`.
6. IF exifr rejects or throws THEN the extractor SHALL emit warning `exif-parse-failed` and add `gps-location`, `device-identity`, `software-trail`, `capture-time`, `author-identity` and `embedded-thumbnail` to `unchecked`. Ghosts from XMP, ICC, text chunks and trailing data SHALL still be reported.
7. WHEN the MakerNote tag `0x927C` is present THEN the extractor SHALL report a `device-identity` ghost titled "Vendor maker note (may contain serial numbers)" with severity `shade` and confidence 0.5. MakerNote contents are not decoded in v1.

### Requirement 6: GPS location

**User Story:** As someone selling a sofa online, I want to see where my photo says I live, as a place name and not just numbers, so that I take the risk seriously.

#### Acceptance Criteria

1. WHEN the GPS IFD has `GPSLatitude` (`0x0002`, 3 RATIONAL) with `GPSLatitudeRef` (`0x0001`) and `GPSLongitude` (`0x0004`) with `GPSLongitudeRef` (`0x0003`) THEN the system SHALL compute decimal degrees `d + m/60 + s/3600`, negated for `S`/`W`.
2. WHEN XMP has `exif:GPSLatitude`/`exif:GPSLongitude` in the XMP form `DDD,MM.mmmmk` or `DDD,MM,SSk` (`k` ∈ N/S/E/W) THEN the system SHALL parse it the same way.
3. IF the result is finite with `|lat| ≤ 90`, `|lon| ≤ 180` and not exactly `(0, 0)` THEN the system SHALL report a `gps-location` ghost:
   - severity `revenant`, confidence 1;
   - summary `GPS <lat>, <lon>`, each to 5 decimal places;
   - fields `Latitude`, `Longitude`, `Place (offline)`, plus, when present, `Altitude` (`0x0006`, metres, negative when `0x0005` = 1), `Direction` (`0x0011`, degrees) and `GPS time (UTC)` (from `0x001D` and `0x0007`);
   - `evidence.raw = { lat, lon }`.
4. IF the GPS tags are present but invalid or `(0, 0)` THEN the system SHALL report a `gps-location` ghost titled "Zeroed or invalid GPS tags" with severity `shade` and confidence 0.5.
5. WHEN textual location fields are present (IPTC 2:90 City, 2:92 Sub-location, 2:95 Province/State, 2:101 Country; XMP `photoshop:City`, `photoshop:State`, `photoshop:Country`, `Iptc4xmpCore:Location`) THEN the system SHALL report a `gps-location` ghost titled "Place names in metadata" with severity `wraith`.
6. The system SHALL compute `Place (offline)` with `nearestPlace(lat, lon)` from the bundled gazetteer: GeoNames cities with population ≥ 100,000 (CC BY 4.0), loaded lazily as a separate chunk of ≤ 80 KB gzip. It SHALL return the entry that minimizes haversine distance (R = 6371.0088 km), breaking ties by the lowest table index. The display format SHALL be:
   - `≈ <d> km from <Name>, <CC>`, with `d` rounded to 1 km below 10 km and to 5 km otherwise;
   - `Remote area, nearest city <Name>, <CC> (<d> km)` when `d > 300`.
7. IF the gazetteer fails to load THEN `Place (offline)` SHALL be `unavailable` and the system SHALL emit warning `gazetteer-unavailable`. The ghost SHALL still be reported.
8. The web UI SHALL show the coordinates and `Place (offline)` by default. It SHALL NOT make any network request to show them.
9. The web UI SHALL show a button labelled exactly `Show on map (sends coordinates to OpenStreetMap tiles)`. Only WHEN the user activates that button for that ghost SHALL `apps/web/src/ui/opt-in-map.ts` load a 3×3 grid of zoom-15 tiles from `https://tile.openstreetmap.org/15/{x}/{y}.png`. The tiles SHALL be centred on the tile that contains the point, using latitude clamped to ±85.05112878, `x = ⌊(lon+180)/360 · 2¹⁵⌋` and `y = ⌊(1 − ln(tan φ + sec φ)/π)/2 · 2¹⁵⌋`. Each tile SHALL use `referrerpolicy="strict-origin"`, and the grid SHALL show the attribution "© OpenStreetMap contributors".
10. Consent SHALL apply to one ghost in one séance. It SHALL NOT be written to any storage. A new file or a page reload SHALL need a new click.
11. No source file under `apps/web/src` or `packages/core/src` other than `apps/web/src/ui/opt-in-map.ts` SHALL contain the string `tile.openstreetmap.org`. This SHALL be enforced by a lint rule. The only other place it may appear is the CSP in `apps/web/index.html`.

### Requirement 7: Device identity

**User Story:** As a stalking survivor, I want to know if a photo carries my camera's serial number, so that I know my posts can be linked to each other.

#### Acceptance Criteria

1. The system SHALL map these sources to `device-identity`:
   - Exif `Make` (`0x010F`), `Model` (`0x0110`), `HostComputer` (`0x013C`), `BodySerialNumber` (`0xA431`), `LensMake` (`0xA433`), `LensModel` (`0xA434`), `LensSerialNumber` (`0xA435`);
   - XMP `aux:SerialNumber`, `aux:LensSerialNumber`, `aux:Lens`, `exifEX:BodySerialNumber`, `exifEX:LensSerialNumber`, `tiff:Make`, `tiff:Model`;
   - the PNG text keyword `Source`.
2. Severity SHALL be `wraith` when any serial-number source (`0xA431`, `0xA435`, `aux:SerialNumber`, `aux:LensSerialNumber`, `exifEX:*SerialNumber`) is present and non-empty after trimming. Otherwise it SHALL be `shade`.
3. Serial values SHALL be shown in full in `evidence.fields`, in mono. The summary SHALL mask all but the last 4 characters (for example `Serial ••••••7781`), so the ledger summary is safe to screenshot.

### Requirement 8: Author identity, software trail and capture time

**User Story:** As a person sharing an edited photo, I want to see names, editing history and timestamps it carries, so that I know what it says about me and when.

#### Acceptance Criteria

1. The system SHALL map these sources to `author-identity`, with severity `wraith`:
   - Exif `Artist` (`0x013B`), `Copyright` (`0x8298`), `XPAuthor` (`0x9C9D`, UCS-2LE), `CameraOwnerName` (`0xA430`);
   - XMP `dc:creator`, `dc:rights`, `xmpRights:Owner`, `photoshop:AuthorsPosition`, `photoshop:Credit`, `aux:OwnerName`;
   - IPTC 2:80 By-line, 2:85 By-line Title, 2:110 Credit, 2:116 Copyright Notice, 2:122 Writer/Editor;
   - PNG keywords `Author` and `Copyright`.

   Values that are empty after trimming SHALL be ignored.
2. The system SHALL map these sources to `software-trail`:
   - Exif `ProcessingSoftware` (`0x000B`), `Software` (`0x0131`), `ImageDescription` (`0x010E`), `ImageUniqueID` (`0xA420`), `UserComment` (`0x9286`), `XPTitle`/`XPComment`/`XPKeywords`/`XPSubject` (`0x9C9B`–`0x9C9F`, excluding `0x9C9D`);
   - XMP `xmp:CreatorTool`, `xmpMM:History` (count of `stEvt` events and their `stEvt:softwareAgent` values), `xmpMM:DocumentID`, `xmpMM:OriginalDocumentID`, `xmpMM:DerivedFrom`, `photoshop:DocumentAncestors`;
   - PNG keywords `Software`, `Title`, `Description`, `Comment`, `Disclaimer`, `Warning`, and any non-standard keyword.

   Severity SHALL be `shade` when any of `xmpMM:History`, `OriginalDocumentID`, `DerivedFrom`, `DocumentAncestors`, `ImageUniqueID`, or a non-empty free-text field (`0x010E`, `0x9286`, `XP*`, PNG `Title`/`Description`/`Comment`) is present. Otherwise it SHALL be `wisp`.
3. The system SHALL map these sources to `capture-time`:
   - Exif `DateTimeOriginal` (`0x9003`), `DateTimeDigitized` (`0x9004`), `DateTime` (`0x0132`), `OffsetTime*` (`0x9010`–`0x9012`), `SubSecTime*`;
   - XMP `xmp:CreateDate`, `xmp:ModifyDate`, `photoshop:DateCreated`, `exif:DateTimeOriginal`;
   - IPTC 2:55 Date Created and 2:60 Time Created;
   - the PNG `tIME` chunk and the PNG keyword `Creation Time`.

   Severity SHALL be `shade` when an original or creation time, or a UTC offset, is present. It SHALL be `wisp` when only modification times (`0x0132`, `xmp:ModifyDate`, `tIME`) are present.
4. WHEN a UTC offset (`0x9011` or a `±hh:mm` suffix) is present THEN the evidence SHALL include a field `Time zone` and the explanation SHALL say that the offset narrows the region.

### Requirement 9: Embedded thumbnail

**User Story:** As someone who cropped a photo before posting, I want to know if a thumbnail of the uncropped original is still inside, so that the crop actually protects me.

#### Acceptance Criteria

1. WHEN IFD1 has `JPEGInterchangeFormat` (`0x0201`) and `JPEGInterchangeFormatLength` (`0x0202`), `tiffStart + offset + length ≤ container end`, and the bytes start with `FF D8` THEN the system SHALL report an `embedded-thumbnail` ghost. Here `tiffStart` is the TIFF header offset: `APP1 payloadStart + 6` for JPEG, the `eXIf` `dataStart` for PNG.
2. The ghost's location SHALL be `{ type: 'byte-range', start: tiffStart + offset, end: tiffStart + offset + length }`. Its `evidence.preview` SHALL be `{ mime: 'image/jpeg', bytes: <copy of that range>, width, height }`, with dimensions from the thumbnail's SOFn segment.
3. The system SHALL also detect:
   - JFIF APP0 thumbnails (`Xthumbnail · Ythumbnail > 0`, RGB bytes; previewed through the PNG encoder);
   - JFXX extension thumbnails (codes `0x10` JPEG, `0x11` palette, `0x13` RGB);
   - Photoshop IRB resources `0x0409`/`0x040C` (JPEG data after a 28-byte header).
4. Severity SHALL be `wraith` when the thumbnail's aspect ratio differs from the main image's stored dimensions (IHDR, or the SOFn of the primary image) by more than 2% (`|a_t − a_m| / a_m > 0.02`), because this suggests it was taken before a crop. Otherwise severity SHALL be `shade`. Confidence SHALL be 1.
5. IF IFD1 describes an uncompressed thumbnail (`Compression` `0x0103` = 1 with strips) THEN the system SHALL report the ghost without a preview and emit warning `thumbnail-uncompressed-no-preview`.
6. IF the offsets are out of range THEN the system SHALL emit warning `thumbnail-out-of-range` and add `embedded-thumbnail` to `unchecked`.

### Requirement 10: ICC profile identity

**User Story:** As a designer, I want to know if my monitor-calibration profile names me or my machine, so that exported images don't carry it.

#### Acceptance Criteria

1. The system SHALL rebuild ICC profiles:
   - for JPEG, from APP2 `ICC_PROFILE\0` segments ordered by their 1-based sequence byte, checked against the count byte;
   - for PNG, from `iCCP` (profile name of 1–79 bytes, `00`, method `00`, zlib data inflated within the decompression meter);
   - for HEIC, from the `colr` box with type `prof`.
2. The system SHALL parse the ICC header (size at bytes 0–3, `acsp` at 36–39) and the tag table (count at byte 128, then 12-byte entries: signature, offset, size). It SHALL read `desc` (v2 `textDescriptionType` or v4 `multiLocalizedUnicodeType`, first record), `dmnd`, `dmdd` and `cprt`.
3. IF the normalized description is in the bundled standard-profile list (design.md) AND `dmnd`, `dmdd` and the PNG `iCCP` name are each absent or also standard THEN the system SHALL report no ghost.
4. Otherwise the system SHALL report one `icc-profile-identity` ghost with severity `shade` and confidence 0.8. The fields SHALL include `Description`, `Device maker`, `Device model`, `Copyright` and `Profile name` (PNG) where present.
5. IF JPEG ICC segments are missing or duplicated, or the profile fails to parse THEN the system SHALL emit warning `icc-incomplete` and add `icc-profile-identity` to `unchecked`.

### Requirement 11: PNG text chunks

**User Story:** As a developer who exports charts as PNG, I want to see the text chunks my tools write, so that I notice when a file path or username is embedded.

#### Acceptance Criteria

1. The system SHALL decode:
   - `tEXt`: keyword in Latin-1, `00`, text in Latin-1;
   - `zTXt`: keyword, `00`, method `00`, zlib-compressed Latin-1 text;
   - `iTXt`: keyword, `00`, compression flag, method, language tag, `00`, translated keyword, `00`, UTF-8 text, zlib-compressed when the flag is 1.
2. The system SHALL map keywords case-insensitively: `Author`/`Copyright` → `author-identity` (`wraith`); `Creation Time` → `capture-time` (`shade`); `Source` → `device-identity` (`shade`); `Software` → `software-trail` (`wisp`); `Title`/`Description`/`Comment`/`Disclaimer`/`Warning` → `software-trail` (`shade` when the text is non-empty); any other keyword → `software-trail` (`wisp`).
3. WHEN the keyword is `XML:com.adobe.xmp` THEN the system SHALL send the text to the XMP reader and SHALL report XMP findings instead of a text ghost.
4. WHEN the keyword starts with `Raw profile type ` (ImageMagick hex dump: newline, name, newline, length, newline, hex lines) THEN the system SHALL hex-decode the payload. For `exif`/`APP1`, after an optional `Exif\0\0`, it SHALL send the payload to exifr. For `xmp`, it SHALL send it to the XMP reader. For `icc`/`icm`, it SHALL send it to the ICC parser. Other profiles SHALL be reported as a `software-trail` ghost (`shade`) named after the profile.
5. Text ghosts SHALL show `Keyword` and `Text` (first 500 characters, with `…` when truncated) in their fields. `evidence.raw.text` SHALL hold the full text.
6. IF the keyword length is 0 or more than 79 THEN the system SHALL emit warning `png-text-bad-keyword` and still report the ghost. IF zlib decoding fails THEN the system SHALL emit `png-text-bad-zlib` and add the mapped kind to `unchecked`.

### Requirement 12: HEIC

**User Story:** As an iPhone user, I want HEIC photos checked for the same location and device ghosts as JPEGs, so that the default phone format isn't a blind spot.

#### Acceptance Criteria

1. The system SHALL walk HEIC top-level ISOBMFF boxes: 32-bit size, where size 1 means a 64-bit `largesize` follows and size 0 means the box runs to the end. Box types SHALL be 4 bytes in `[0x20, 0x7E]`.
2. WHEN all top-level boxes are well-formed and the last box ends before `byteLength` THEN the system SHALL report a `trailing-data` ghost for the rest, classified per Requirement 2.3.
3. The system SHALL locate the `Exif` item and the XMP item (`mime` with content type `application/rdf+xml`) through `meta`/`iinf`/`iloc` (versions 0–2, `construction_method` 0 only). For Exif, the 4-byte TIFF header offset prefix SHALL be skipped. It SHALL then apply Requirements 5–8 with locations `heic/Exif` and `heic/XMP` covering the item extents.
4. IF item extents cannot be resolved THEN the system SHALL still parse metadata from the whole file with exifr, use `{ type: 'byte-range', start: 0, end: byteLength }` as the location, and emit warning `heic-location-approx`.
5. WHEN an `iref` box contains a `thmb` reference THEN the system SHALL report an `embedded-thumbnail` ghost (`shade`, confidence 0.8) located at that item's extent and without a preview, because offline HEVC decoding is not available.
6. The HEIC extractor's `detects` SHALL NOT include `recovered-image` or `text-in-pixels`. `carries` makes both appear in `unchecked`.

### Requirement 13: Robustness, budgets and completeness

**User Story:** As a user dropping hostile images, I want partial results instead of crashes, and every planted ghost found, so that I can trust the ledger (G4, G5).

#### Acceptance Criteria

1. The PNG, JPEG and HEIC extractors SHALL never throw. Each sub-parser (walker, exifr, XMP, ICC, text, thumbnail, trailing, reconstruction) SHALL run in its own guarded section. On failure, the section SHALL emit `<section>-parse-failed` and add its kinds to `unchecked`.
2. `detects` SHALL be:
   - `png` and `jpeg`: `trailing-data`, `recovered-image`, `embedded-thumbnail`, `gps-location`, `device-identity`, `software-trail`, `capture-time`, `author-identity`, `icc-profile-identity`;
   - `heic`: the same list without `recovered-image`.
3. WHEN the input is no larger than 25 MiB and `signal` is not aborted THEN the PNG and JPEG extractors, excluding aCropalypse reconstruction, SHALL finish within 2 s per MiB on the CI reference runner.
4. For every curse produced by the Paw image arbitraries, `inspect` SHALL report a ghost of every planted kind (G4).
