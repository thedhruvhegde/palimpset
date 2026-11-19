---
inclusion: fileMatch
fileMatchPattern: "apps/web/src/**/*.{ts,css,glsl,html}"
---

# Art direction: Illuminated Codex

Design canvas: https://claude.ai/artifact/JH8SvA8MKrSyeW62ZzcoHA (landing, séance, exorcism, the Paw, design system).

## Principles
1. **Spooky clarifies.** Every effect maps to meaning: scraping means revealing, **lapis** blue means "this was hidden", **vermilion** means "act now" (the two pigments of illuminated manuscripts). If an effect doesn't carry meaning, cut it.
2. **Parchment in gold leaf, void around it.** The file always sits on warm parchment inside a gilded double frame; the app chrome is near-black void.
3. **Evidence is mono.** Every concrete value (bytes, coordinates, names) is set in IBM Plex Mono so it reads as fact.
4. **Never color alone.** Severity has a name, a lightness step and a color.

## Tokens (mirror exactly in `apps/web/src/ui/tokens.css`)
| Token | Hex | Use |
|---|---|---|
| `--void-950` | #08070B | app background |
| `--void-900` | #12101A | raised panels |
| `--void-800` | #1B1826 | inputs, hovers |
| `--line` / `--line-strong` | #2A2536 / #3B3350 | hairlines |
| `--bone-100` / `--bone-300` / `--bone-500` | #F1ECE2 / #C7C0D4 / #A39CB4 | text on dark (all ≥ 4.5:1) |
| `--parchment-200` | #EFE3C8 | file surface |
| `--ink-900` | #1D1626 | text on parchment |
| `--gold-500` / `--gold-800` | #C9A24A / #5E4A20 | gilded frame rules |
| `--lapis-300` / `--lapis-100` | #7D9BFF / #E6ECFF | revealed ghosts, safe primary, focus |
| `--vermilion-500` | #E5452B | exorcise, danger primary |
| `--gold-400` | #D4A64A | warnings, "shade" severity |

Severity chips: revenant = solid vermilion with #1A0808 text; wraith = vermilion 18% tint with #F59A86; shade = gold 16% tint with #E4C27A; wisp = #9AA3C7 16% tint with #B3BBDB.

## Type
- Display: **Cormorant SC** 600 (headings, hero numbers), letter-spacing 0.04–0.12em.
- Body: **Instrument Sans** 16–20 px, line-height 1.55.
- Evidence: **IBM Plex Mono** 12–15 px.
- Self-host fonts in `apps/web/public/fonts` (no Google Fonts request at runtime, because of G1).

## Motion and sound
- Scrape: a WebGL2 shader on the vellum. The pointer stroke erodes a mask texture, the ghost layer shows through with ink-bleed noise at the edge, and a faint lapis glow follows the stroke.
- Reveal of a high-severity ghost: a slow 600 ms bleed-up, then the ledger card slides in.
- Exorcism: the ledger cards burn away (vermilion embers) one by one, then silence and a lapis check.
- Sound (opt-in toggle, off by default): procedural Web Audio whispers per ghost, and a rising choir on exorcism that cuts to silence.
- Respect `prefers-reduced-motion`: replace the shader with a crossfade and turn off particles.

## Accessibility
- Every scrape-revealed ghost is also listed in the Séance Ledger. Scraping is never the only way to see a ghost ("Reveal all layers" button).
- Keyboard: Tab to the vellum; arrow keys scrape in a grid; Enter reveals all.
- Touch targets ≥ 44 px; focus rings in lapis-300; contrast ≥ 4.5:1 for text.
