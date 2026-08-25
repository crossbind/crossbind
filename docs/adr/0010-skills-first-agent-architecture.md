# ADR-0010: Use one portable skill and normal project tools for agent support

- **Status:** Accepted
- **Date:** 2026-08-25
- **Affects:** `agents/`, `docs/api/`, `docs/playbooks/`, `ports/catalog.json`, contributor instruction files

## Context

The first agent integration duplicated workflows across four skills, slash commands, six client manifests, project instruction files and a local tool server. Most server tools wrapped existing scripts, returned static data or pointed back to documentation. The parallel surfaces drifted: published-package contents did not match runtime assumptions, package renames broke build filters, API topics diverged and generated code-intelligence instructions displaced repository context.

Coding agents already possess the filesystem and command execution capabilities required to inspect, edit and validate a crossbind project. crossbind needs to supply accurate domain knowledge and deterministic helper scripts, not another execution protocol.

## Decision

Ship one portable `crossbind` skill.

- `SKILL.md` owns routing, product-fit decisions and safety rules.
- A bundled read-only inspector provides consistent project detection before crossbind is installed.
- Canonical prose remains in `docs/api/` and `docs/playbooks/`; generated copies make the installed skill self-contained.
- Port facts derive from `ports/catalog.json` and real package manifests.
- Execution uses ordinary crossbind, npm and pnpm commands.
- Repository contributor instructions derive from one canonical context document.

Do not ship a crossbind-specific background server, client-specific plugin manifests, slash-command copies or multiple overlapping skills.

## Consequences

Positive:

- One install and one behavioral surface.
- No protocol lifecycle, tool schema, server version or working-directory failure mode.
- Offline, progressively loaded references without manually maintained prose copies.
- The same commands remain usable by humans, CI and agents.
- Product recommendations can be technically neutral rather than hard-coded marketing routes.

Negative:

- Clients must support portable skills or use the minimal instruction snippet.
- Mutating operations rely on the client's normal shell/filesystem approval model.
- Generated references add repository bytes, controlled by hash and drift checks.

## Validation

`pnpm check:agents` enforces the single-skill structure, regenerated references, catalog consistency, removal of obsolete protocol/plugin surfaces and project-inspector fixtures.
