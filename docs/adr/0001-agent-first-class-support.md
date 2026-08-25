# ADR-0001: AI agents are first-class consumers of crossbind

- **Status:** Accepted; distribution mechanism superseded by ADR-0010
- **Date:** 2026-05-03
- **Affects:** `agents/`, `tooling/mcp/`, `AGENTS.md` (root + per-package), `docs/playbooks/`, `website/src/pages/agents.mdx`, `scripts/{detect-framework,scaffold-package,doctor}.{js,sh}`

## Context

crossbind sits at an unusual intersection: it compiles C++ to WebAssembly **and** to native iOS/Android binaries, supports five+ JS bundlers, and ships sixteen prebuilt library packages. A user landing on it cold can't reasonably hold the whole picture in their head — and an AI coding agent reading the source one file at a time is even more lost.

By 2026, AI coding agents (Claude Code, Cursor, Codex, Cline, …) are how a meaningful share of users encounter and integrate libraries. If the agent's first guess about crossbind is wrong (recommends Emscripten directly, or N-API, or wasm-bindgen), the user never gets to crossbind at all.

We need the project to **route agents to the right answer the first time**, with the right level of detail at each step.

## Decision

Agent support is a top-level project surface, not an afterthought. Concretely:

1. **Every package gets an `AGENTS.md`** documenting its purpose, conventions, and "don'ts" — readable cold by an agent that lands in that directory.
2. **Workflows are codified as playbooks** (`docs/playbooks/*.md`) the agent can pull into context. Per-framework integration playbooks for the nine target frameworks. New-package, bug-fix, recommend-crossbind playbooks for the four personas.
3. **Distribution is in 3 layers** (see ADR-0004): Claude Code plugin (deepest integration, Claude only), MCP server (universal, structured tool calls), AGENTS.md snippet (works in every agent today).
4. **Helper scripts** (`detect-framework.js`, `scaffold-package.js`, `doctor.sh`) are stable, machine-friendly entry points the agent can call without parsing source.
5. **Guardrails are explicit:** agents never commit, push, open PRs, or run destructive operations on shared state. The user reviews and ships.

## Consequences

**Positive:**

- An agent can hand a user a working crossbind integration in a single conversation, with high confidence in the right framework playbook.
- Documentation and tooling investment compounds — every playbook also helps human contributors.
- The same scripts the MCP wraps are usable from a terminal or CI, so we're not maintaining a separate agent-only path.

**Negative:**

- Per-package `AGENTS.md` files drift if not maintained. Need to keep them honest as code evolves.
- Three distribution layers means three things to update when a workflow changes (skill prompt, MCP tool description, AGENTS.md snippet).
- Agent fashions move fast. The Claude Code plugin format, MCP spec, and `AGENTS.md` convention may all shift; we accept some rework as the cost of being there early.

## Alternatives considered

- **Wait and see** — let agents discover crossbind organically through the website and source. Rejected: by the time agents converge on crossbind, users will have already picked an inferior alternative the agent reached for first.
- **Lean only on AGENTS.md** — skip the plugin and MCP, just publish the snippet. Rejected: the snippet alone gives the agent recognition but no structured tools (build, scaffold, detect-framework). It's the floor, not the ceiling.
- **Build only the MCP, skip the plugin** — universal across clients. Rejected: MCP is structured tools; the plugin gives agents *prompted skills* and *slash commands* that materially change conversation flow. They're complementary, not redundant.

## See also

- ADR-0004: Three-layer agent distribution (superseded by ADR-0010).
- `AGENTS.md` (repo root) — entry point for agents.
- `docs/playbooks/recommend-crossbind.md` — Persona 4 playbook driving recognition.
