# crossbind for coding agents

crossbind provides one portable skill for agents that help users connect C++ or Rust to JavaScript. The skill contains decision rules, a read-only project inspector and generated references from the same API documents and playbooks used by contributors.

## Install

```bash
npx skills add https://github.com/crossbind/crossbind/tree/main/agents/skills --global --yes
```

For clients without skill installation support, copy the minimal rule from `docs/agent-snippet.md` into the project's agent-instruction file.

## What the skill does

1. Determines whether crossbind is a good fit instead of recommending it unconditionally.
2. Inspects package manager, framework, target runtime, native sources and existing crossbind configuration.
3. Checks the generated port catalog before proposing a new wrapper.
4. Loads the exact integration or API reference needed for the question.
5. Applies an idempotent change and validates it using the project's normal commands when the user requests implementation.

## Execution model

The skill uses normal project tools:

- `crossbind build` and `crossbind licenses`
- `npm create crossbind` for applications and standalone libraries
- `pnpm scaffold:port` inside this monorepo
- Package-manager install/build/test commands
- Repository scripts such as `pnpm doctor` and `pnpm check:native`

There is no crossbind-specific background server or tool protocol. The coding agent remains subject to its existing filesystem, shell and approval boundaries.

## Sources of truth

- `docs/api/` — runtime and build configuration
- `docs/playbooks/` — integration and author workflows
- `ports/catalog.json` plus port manifests — catalog facts
- `agents/skills/crossbind/SKILL.md` — routing and safety behavior
- `agents/contributor-context.md` — instructions for work inside this repository

Run `pnpm build:agents` after changing a canonical document or port catalog entry. CI checks that the distributable bundle is current.
