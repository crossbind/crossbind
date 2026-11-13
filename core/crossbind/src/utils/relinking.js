// What a package that links LGPL libraries statically tells its user: where the corresponding source is and how to
// build the artifact again with a modified library. A Node-API addon's LICENSE and a wasm module's notices both carry it.
export const OVERRIDE_PLAYBOOK = 'https://github.com/crossbind/crossbind/blob/main/docs/playbooks/override-dependencies.md';
export const DEFAULT_SOURCE_TAG = '{name}@{version}';

export function lgplRows(rows) {
    return rows.filter((row) => /\bLGPL\b/.test(row.license ?? ''));
}

export const sourceTagOf = (format, name, version) => (format || DEFAULT_SOURCE_TAG)
    .replaceAll('{name}', name)
    .replaceAll('{version}', version);

const listOf = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

const ARTIFACTS = {
    addon: (file, projectPath) => ({
        noun: 'addon',
        verb: 'relink the addon',
        where: 'Linux and Windows addons build in Docker, macOS addons on a Mac.',
        result: `The build writes ${file} in ${projectPath}; it replaces the file of that name in this package.`,
    }),
    module: (_file, projectPath) => ({
        noun: 'module',
        verb: 'build the module again',
        where: "The build runs in crossbind's toolchain: Docker, a remote runner or crossbind cloud.",
        result: `The build writes the module's files in ${projectPath}/dist; they replace the files of those names in this package.`,
    }),
};

export function relinkSection({ name, version, repository, projectPath, rows, sourceTag, artifact = 'addon', file = null }) {
    const tag = sourceTagOf(sourceTag, name, version);
    const repo = repository.replace(/\.git$/, '');
    const { noun, verb, where, result } = ARTIFACTS[artifact](file, projectPath);
    return [
        '## Relinking the LGPL libraries',
        '',
        `This ${noun} links ${listOf(rows.map((row) => row.name))} statically; their sections below give their licenses.`,
        `You may replace them with modified versions and ${verb}:`,
        '',
        `1. Get the corresponding source. This package was built from ${repo} at the tag ${tag}:`,
        `   ${repo}/tree/${tag}`,
        '   The upstream sources are the tarballs the sections below list, with their SHA-256.',
        `2. In ${projectPath}, point the library at your modified source with a crossbind.overrides.js file`,
        `   (${OVERRIDE_PLAYBOOK}).`,
        `3. Build the packages the ${noun} links first, as their dist/ folders are not in git, then the ${noun} with`,
        `   \`pnpm install\` and \`pnpm --dir ${projectPath} build\`. ${where}`,
        `4. ${result}`,
    ].join('\n');
}
