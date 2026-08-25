# Install the crossbind skill

Install the single crossbind skill with the Skills CLI:

```bash
npx skills add https://github.com/crossbind/crossbind/tree/main/agents/skills --global --yes
```

For a project-local installation, omit `--global`:

```bash
npx skills add https://github.com/crossbind/crossbind/tree/main/agents/skills --yes
```

The installed skill includes:

- Product-fit and workflow routing
- A read-only framework/project inspector
- Per-framework integration playbooks
- Runtime, configuration, filesystem, threading and troubleshooting references
- A generated catalog of current crossbind ports and supported targets

It does not start a background process or install an execution protocol. Your coding agent reads files, edits the project and runs normal package-manager/crossbind commands using its existing permissions.

## Verify

List installed skills and confirm `crossbind` appears:

```bash
npx skills list
```

Then ask:

> Inspect this project and tell me how you would add GDAL with crossbind. Do not edit anything yet.

The agent should inspect the project, identify the framework, find `@crossbind/port-gdal`, load the matching integration reference and mention production COOP/COEP only if a browser multithread build is relevant.

See `docs/playbooks/verify-install.md` for the complete verification checklist.
