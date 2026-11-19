# Design: Illuminated Codex

**Design canvas (5 screens):** https://claude.ai/artifact/JH8SvA8MKrSyeW62ZzcoHA

1. **Landing:** "Lay your file upon the parchment" drop zone, privacy promise, Haunted Gallery.
2. **Séance:** the file on parchment, scrape toolbar, the recovered region glowing below the crop line, Séance Ledger.
3. **Exorcism:** before/after ghost lists, the Paw's verification, download.
4. **The Paw:** five fingers (one per property), a shrunk counterexample trace and what it caught.
5. **Design system:** palette, type, severity scale, components.

Tokens live in `apps/web/src/ui/tokens.css`; rules and rationale live in `.kiro/steering/art-direction.md` (loaded by Kiro whenever web files are open).

## Palette
| Role | Token | Hex |
|---|---|---|
| App background | `--void-950` | #08070B |
| Raised panel | `--void-900` | #12101A |
| Text on dark | `--bone-100` / `--bone-300` / `--bone-500` | #F1ECE2 / #C7C0D4 / #A39CB4 |
| File surface | `--parchment-200` | #EFE3C8 |
| Text on parchment | `--ink-900` | #1D1626 |
| Gilded frame | `--gold-500` | #C9A24A |
| Revealed / safe action | `--lapis-300` | #7D9BFF |
| Danger / exorcise | `--vermilion-500` | #E5452B |
| Warning / shade | `--gold-400` | #D4A64A |

## Type
Cormorant SC (display) · Instrument Sans (body) · IBM Plex Mono (evidence). Self-hosted, because a Google Fonts request would break the no-network guarantee.

## Severity
Revenant (identity or location exposed) > Wraith (directly identifying) > Shade (indirectly identifying) > Wisp (low risk alone). Each severity is shown as a named chip, not by color alone.
