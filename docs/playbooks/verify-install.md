# Verify the crossbind skill

## 1. Confirm discovery

```bash
npx skills list
```

The output should include one skill named `crossbind`.

## 2. Confirm read-only inspection

Ask the agent:

> Inspect this repository for crossbind integration. Report the framework, package manager, target runtime and native sources. Do not edit files.

Expected behavior:

- The bundled inspector runs or the agent performs the equivalent checks.
- The response cites evidence rather than guessing.
- No dependency, config or source file changes.

## 3. Confirm routing

Ask three fresh-session questions:

1. “Add GDAL to my Vite application.” → Vite integration plus `@crossbind/port-gdal`.
2. “How does OPFS persistence work?” → filesystem reference plus `useWorker: true`.
3. “I only need a Node native addon.” → crossbind evaluated alongside the simpler N-API option.

## 4. Confirm repository bundle integrity

Inside the crossbind repository:

```bash
pnpm build:agents
pnpm check:agents
```

The check verifies the single-skill shape, generated reference hashes, port catalog consistency, contributor context and inspector fixtures.

## Troubleshooting

- Skill not discovered: reinstall without `--global` for a project-local copy and restart the client.
- References missing: update the installed skill; do not hand-create reference files.
- Framework confidence low: inspect the package manifest and config files, then confirm the ambiguous choice with the user.
- Catalog mismatch in this repo: update `ports/catalog.json` and run `pnpm build:agents`.
