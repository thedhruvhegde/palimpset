---
inclusion: fileMatch
fileMatchPattern: "apps/web/src/**/*.{ts,css,glsl,html}"
---

# Art direction: Afterimage

Design canvas: https://claude.ai/artifact/JH8SvA8MKrSyeW62ZzcoHA (landing, findings, clean copy, the Paw, design system).

## Principles
1. **A calm, precise security tool.** Dark, minimal, modern (think Linear or Vercel). Plain language first, theme words second: "7 ghosts found" with the subtitle "hidden data this file carries".
2. **The haunting is in the reveal, not the chrome.** The single spooky effect: recovered data glows spectral violet behind faint scan lines, under a dashed coral crop line. Nothing else glows.
3. **One accent per meaning.** Spectral violet = was hidden. Coral = remove / failed. Green = safe / verified. Amber = medium severity.
4. **Evidence is mono.** Concrete values (bytes, coordinates, names) use Geist Mono.
5. **Never color alone.** Severity always has a word: Critical, High, Medium, Low (in code: revenant, wraith, shade, wisp).
6. **No illustrations or mascots.** Show real-looking files (for example a marketplace listing screenshot), never drawings.

## Tokens (mirror exactly in `apps/web/src/ui/tokens.css`)
| Token | Hex | Use |
|---|---|---|
| `--bg` | #0B0B0D | app background |
| `--surface` / `--surface-2` | #131316 / #1A1A1F | cards, chips |
| `--canvas` | #0F0F12 | dotted backdrop behind the file preview |
| `--border` / `--border-subtle` / `--border-strong` | #26262D / #1F1F24 / #34343D | hairlines |
| `--text-strong` / `--text` | #F5F5F7 / #EDEDF0 | headings / body on dark |
| `--muted` / `--subtle` | #A0A0AB / #7A7A85 | secondary / tertiary text (both ≥ 4.5:1 on --bg) |
| `--spectral` / `--spectral-text` / `--spectral-glow` | #A594FF / #C4B8FF / #E2DCFF | revealed data, links, stress-test button |
| `--danger` / `--danger-text` | #FF6B5B / #FF8E80 | remove button (dark #160606 text), crop line, failures |
| `--warn` | #F2B34C | medium severity |
| `--safe` | #5BD69A | verified, removed, passing |

Severity badges: critical = solid coral with #160606 text; high = coral 14% tint with #FF8E80; medium = amber 14% tint with #F2B34C; low = #8E9BB5 14% tint with #AEB8CC.

## Type
- **Geist** for everything: display 44–60 px / 600 / letter-spacing −0.035em; headings 18–22 / 600; body 14–18 / 400 / line-height 1.6.
- **Geist Mono** 12–13 px for evidence, file names and badges like PNG.
- Self-host both in `apps/web/public/fonts` (no Google Fonts request at runtime, because of G1).

## Motion and sound
- Scrub: a WebGL2 shader over the file preview. The pointer stroke erodes a mask texture and the hidden layer shows through with the reveal treatment (violet scan lines and glow), with a soft noisy edge.
- Reveal of a high-severity ghost: a slow 600 ms bleed-up, then the ledger card slides in.
- Clean copy: finding cards strike through and fade one by one, then a green check.
- Sound (opt-in toggle, off by default): procedural Web Audio whispers per ghost, and a rising choir on exorcism that cuts to silence.
- Respect `prefers-reduced-motion`: replace the shader with a crossfade and turn off particles.

## Accessibility
- Every scrape-revealed ghost is also listed in the Séance Ledger. Scraping is never the only way to see a ghost ("Reveal all layers" button).
- Keyboard: Tab to the file preview; arrow keys scrape in a grid; Enter reveals all.
- Touch targets ≥ 44 px; focus rings in --spectral; contrast ≥ 4.5:1 for text.
