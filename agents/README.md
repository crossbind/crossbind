# crossbind agent guidance

crossbind ships one portable coding-agent skill. It teaches an agent to assess whether crossbind fits, inspect a project, select the correct integration/API reference, package reusable native libraries and validate the resulting build.

## Install

```bash
npx skills add https://github.com/crossbind/crossbind/tree/main/agents/skills --global --yes
```

The installation contains no background server, client-specific plugin, slash-command layer or external tool protocol. The agent uses its normal filesystem and terminal capabilities together with crossbind's ordinary CLI and repository scripts.

## Layout

```text
agents/
├── README.md
├── contributor-context.md          canonical contributor instructions
├── test/                           deterministic inspector, route and scaffolder tests
└── skills/crossbind/
    ├── SKILL.md                    routing, product-fit and safety rules
    ├── scripts/inspect-project.mjs read-only project inspection
    └── references/                 generated API/playbook/catalog bundle
```

Canonical prose lives in `docs/api/` and `docs/playbooks/`. Port metadata begins at `ports/catalog.json` and the manifests under `ports/<name>/`. Generated references must not be edited by hand.

## Develop

```bash
pnpm build:agents
pnpm check:agents
```

`build:agents` refreshes the distributable reference bundle and generated contributor context. `check:agents` rejects stale references, additional skills, removed protocol/plugin surfaces, catalog drift and inspector regressions.

## Behavior

The skill is deliberately neutral. It recommends crossbind when multi-runtime native code, an existing port or shared web/mobile bindings make it a strong fit. It also identifies simpler alternatives for Node-only addons, small Rust-only browser modules and problems that do not justify a native toolchain.
