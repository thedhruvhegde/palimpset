# How Kiro was used (fill in from real notes, then paste into Devpost)

> Write this from what actually happened. Judges reward concrete specifics: a hook that caught a bug, a property that found a leak, a steering rule that changed Kiro's output.

## Kiro surfaces
- IDE: <what you used it for>
- CLI: <what, and how it differed>
- Web / Crew: <what, and how it differed>

## Spec-driven development
- How the specs were structured (9 specs, EARS requirements, correctness properties mapped to fast-check tests).
- One example where the spec-first approach beat vibe coding: <real example>.

## Steering
- The threat-model steering doc kept every generated module network-free: <example>.
- The art-direction doc (fileMatch) kept UI work on the Vellum & Ectoplasm tokens: <example>.
- Biggest-impact strategy: <your answer>.

## Agent hooks
- no-network-guard: <times it fired, anything caught>
- paw-on-extractor-change: <counterexamples found and fixed>
- haunted-asset-guard: <dogfooding story>
- others: <...>

## MCP
- The project's own MCP server, used by Kiro during development: <example>
- External MCP servers used: <...>

## Property-based testing
- Properties: completeness, exorcism soundness, idempotence, robustness, immutability, nested propagation.
- What PBT caught that unit tests missed: <real shrunk counterexample>

## Kiro Powers
- exorcist-power: <what it bundles and how an agent uses it>

## Custom agents
- <if any>
