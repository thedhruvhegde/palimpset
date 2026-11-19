# How to build Palimpsest in Kiro with this starter pack

1. **Open the repo in Kiro** (IDE). Check the Kiro panel shows:
   - **Steering:** product, tech, structure, threat-model (always) and art-direction (only when web files are open).
   - **Specs:** ghost-model-and-ingest, image-ghosts, exorcism, pdf-ghosts, docx-ghosts, the-paw, vellum-ui, mcp-and-power, crew-bot.
   - **Hooks:** six hooks. Open each in the Hooks UI and confirm Kiro parsed it. If the hook file format has changed in your Kiro version, recreate them from the descriptions in the UI (keep the same names).
2. **Review before building.** Open each spec's `requirements.md` and edit anything you disagree with. These are your specs now. Kiro can refine them ("tighten requirement 3 of image-ghosts").
3. **Build task by task.** In each `tasks.md`, click "Start task" on the next unchecked task. Order:
   1. ghost-model-and-ingest
   2. image-ghosts
   3. the-paw (image parts)
   4. vellum-ui (landing, séance)
   5. exorcism (images)
   6. pdf-ghosts
   7. exorcism (pdf)
   8. vellum-ui (exorcism, Paw view)
   9. mcp-and-power
   10. crew-bot
   11. docx-ghosts, if there's time
4. **Use vibe mode only for polish** (copy, spacing, small fixes). Keep features spec-driven, which is what the judges want to see.
5. **Take notes for the write-up as you go** in `docs/KIRO_WRITEUP.md`. Note each time a hook fires usefully, a property test catches something, or a spec change saved you work. Screenshots help.
6. **Try the other Kiro surfaces** at least once each, so the write-up can compare them honestly: Kiro CLI for a batch task (for example regenerating fixtures), Kiro Web if available, and Kiro Crew for the bot.
7. **MCP dogfooding:** once `packages/mcp` builds, set `"disabled": false` in `.kiro/settings/mcp.json` and let the `haunted-asset-guard` hook call `inspect_file`.
8. **Never gitignore `.kiro/`.** Commit specs as tasks get checked off, so the history shows spec-driven progress.
