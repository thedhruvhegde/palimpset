---
inclusion: always
---

# Threat model and privacy guarantees

Palimpsest handles people's most sensitive files. These rules override convenience.

## Guarantees (each is enforced by a test)
1. **G1 Local only.** File bytes never leave the device. No network APIs in core or web code. *Test:* Playwright loads the app, runs every Haunted Gallery fixture through inspect and exorcise, and fails on any request whose origin isn't the app's own static origin.
2. **G2 Original untouched.** Exorcism writes a new file; the input buffer is never mutated. *Test:* property: `bytesBefore` deep-equals `bytesAfter` after `exorcise()`.
3. **G3 No ghost survives exorcism** for supported ghost kinds. *Test:* Paw property: `inspect(exorcise(f)).ghosts` has no ghost of a kind listed in `exorcist.removes`.
4. **G4 Detection completeness** for planted ghosts. *Test:* Paw property: every planted ghost in a generated file is reported by `inspect()`.
5. **G5 Robustness.** Parsers never throw or hang on arbitrary bytes; each extractor has a time budget (default 2 s per MB) and returns partial results with warnings.
6. **G6 Honest output.** Unsupported or uncertain cases are shown as "could not check", never as "clean".

## Opt-in network exception
The GPS ghost may show a map only after the user clicks "Show on map (sends coordinates to OpenStreetMap tiles)". Default display is coordinates plus a reverse-geocoded place name computed offline from a bundled coarse gazetteer. The opt-in path lives in one module (`apps/web/src/ui/opt-in-map.ts`), and the no-network test checks it isn't triggered without the click.

## Out of scope
Steganography, forensic recovery of overwritten data, and video files. Say so in the UI's "What we can't see" panel.

## Handling real data in development
Never commit real personal files. Fixtures are generated with synthetic GPS points (public landmarks), synthetic names ("Ada Quill", "Corwin Vale") and synthetic addresses. The `haunted-asset-guard` hook enforces this.
