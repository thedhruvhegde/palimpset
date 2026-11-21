# Design: Afterimage

**Design canvas (5 screens):** https://claude.ai/artifact/JH8SvA8MKrSyeW62ZzcoHA

1. **Landing:** "See what your files are still hiding", the drop zone, a 3-step "How it works" (Reveal, Clean copy, Verify) and haunted sample files.
2. **Findings:** the file preview (a marketplace listing screenshot), a coral crop line with the recovered pickup address glowing below it, and the list of ghosts with severity badges.
3. **Clean copy:** "All 7 ghosts removed", verification stats (0 ghosts left, 0 network requests, stress-test runs) and what was removed.
4. **The Paw:** the stress test as a checklist of five promises, plus the smallest failing example it found.
5. **Design system:** palette, type, severity, components and the reveal treatment.

Tokens live in `apps/web/src/ui/tokens.css`; rules and rationale live in `.kiro/steering/art-direction.md` (loaded by Kiro whenever web files are open).

## Palette
| Role | Token | Hex |
|---|---|---|
| Background | `--bg` | #0B0B0D |
| Cards | `--surface` | #131316 |
| Borders | `--border` | #26262D |
| Text | `--text` / `--muted` / `--subtle` | #EDEDF0 / #A0A0AB / #7A7A85 |
| Hidden / revealed | `--spectral` | #A594FF |
| Remove / failed | `--danger` | #FF6B5B |
| Medium severity | `--warn` | #F2B34C |
| Safe / verified | `--safe` | #5BD69A |

## Type
Geist and Geist Mono, self-hosted, because a Google Fonts request would break the no-network guarantee.

## Severity
Critical > High > Medium > Low, always shown as a word plus a color. In code these are `revenant`, `wraith`, `shade` and `wisp`.
