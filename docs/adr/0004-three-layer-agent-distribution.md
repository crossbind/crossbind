# ADR-0004: Distribute agent integration in three layers — Claude Code plugin, MCP server, AGENTS.md snippet

- **Status:** Superseded by ADR-0010
- **Date:** 2026-05-03
- **Affects:** `agents/`, `tooling/mcp/`, `website/src/pages/agents.mdx`, `docs/playbooks/`

## Context

ADR-0001 establishes that AI agents are first-class consumers. The next question is **how** we deliver agent support. Each viable channel has different reach, depth, and maintenance cost:

- A **Claude Code plugin** (skills + slash commands) gives Claude Code users the deepest experience — auto-triggering on user phrases, structured slash commands, but only in Claude Code.
- An **MCP server** is vendor-neutral — any MCP-compatible client (Claude Desktop, Cursor, Codex, Cline, …) can call its tools — but provides function calls only, not prompted skills.
- An **`AGENTS.md` snippet** that users paste into their own project root works in every modern agent today, requires no install, but gives the agent text only — no live tools.

We could pick one. We chose all three.

## Decision

Ship three distribution layers in parallel. They serve different audiences and reinforce each other:

| Layer | Reach | Depth | Distribution |
|-------|-------|-------|--------------|
| Claude Code plugin (`agents/`) | Claude Code users | Skills + slash commands + native plugin UX | `/plugin marketplace add crossbind/crossbind` |
| MCP server (`@crossbind/mcp`) | Any MCP-aware agent | 8 typed tools (recommend, list, detect, scaffold, build, …) | `npx -y @crossbind/mcp` in client config |
| AGENTS.md snippet (`agents.mdx`) | Every modern agent | Text-only recognition + routing | Copy-paste into the user's `AGENTS.md` |

Internally, all three layers reference the same `docs/playbooks/*.md` as the source of truth for *what to do*. The plugin and MCP wrap the same `scripts/{detect-framework,scaffold-package,doctor}.{js,sh}` for *what to run*. So the maintenance cost is sub-linear: one workflow update flows through all three.

## Consequences

**Positive:**

- Maximum reach — no agent ecosystem is locked out.
- Each layer plays to its strengths: plugin for Claude Code's native UX, MCP for typed tool calls, snippet for the lowest-friction floor.
- Skills and tools are complementary, not redundant — agents that have both use them in concert (skill prompt picks the workflow → MCP tool executes a step).
- Single source of truth (`docs/playbooks/`) keeps the layers consistent.

**Negative:**

- Three things to update when a workflow changes (skill prompt, MCP tool description, AGENTS.md snippet). Mitigated by the shared playbook, but never zero.
- Three install paths to document and support. Users can be confused about which to pick — we address this on the `crossbind.org/docs/agent/overview` page.
- Spec churn risk × 3. Plugin format, MCP spec, and `AGENTS.md` convention may all evolve independently.

## Alternatives considered

- **Plugin only** — best Claude Code UX, but excludes Cursor, Codex, Cline, Claude Desktop, and every future client. Rejected.
- **MCP only** — universal, but no skill prompts. Agents that don't already know about crossbind won't call its tools because they won't know to. Rejected.
- **AGENTS.md only** — works everywhere today, zero install, but gives agents recognition without execution. The user still has to do the work the tools could automate. Rejected as the floor, not the answer.

## See also

- ADR-0001: AI agents are first-class consumers of crossbind.
- ADR-0010: One portable skill and normal project tools (supersedes this decision).
