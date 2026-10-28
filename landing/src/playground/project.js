import { PACKAGES } from '../../../tooling/cloud/compiler/packages.js';
import { FILE_NAME, MAX_FILES, MAX_PACKAGES } from '../../../tooling/cloud/compiler/validate.js';
import { importSpecifiers } from './modules.js';

// A project in the shape the playground compiler takes: { files: { 'main.js', 'native/<name>': text }, packages: [id] }.

export const MAIN = 'main.js';
const BY_ID = new Map(PACKAGES.map((pkg) => [pkg.id, pkg]));
const STARTERS = Object.freeze({ h: '#pragma once\n', hpp: '#pragma once\n' });

export const packageOf = (id) => BY_ID.get(id);

export const fileNames = (project) => Object.keys(project.files)
    .sort((a, b) => Number(b === MAIN) - Number(a === MAIN) || a.localeCompare(b));

// Why a new native file cannot be called `name`, or null when it can.
export function newFileError(project, name) {
    if (!FILE_NAME.test(`native/${name}`)) return 'Name it like a C identifier, ending in .h, .hpp, .cpp, .cc or .rs.';
    if (`native/${name}` in project.files) return `There is a ${name} already.`;
    if (Object.keys(project.files).length >= MAX_FILES) return `A project holds ${MAX_FILES} files at most.`;
    return null;
}

export function addFile(project, name) {
    const extension = name.slice(name.lastIndexOf('.') + 1);
    return { ...project, files: { ...project.files, [`native/${name}`]: STARTERS[extension] ?? '' } };
}

export const removeFile = (project, file) => ({
    ...project,
    files: Object.fromEntries(Object.entries(project.files).filter(([name]) => name !== file)),
});

export const setFile = (project, file, text) => ({ ...project, files: { ...project.files, [file]: text } });

// The line that puts a package to use: an import in main.js, or an #include in the project's own C++.
export const usageOf = (pkg) => (pkg.use.import
    ? { inMain: true, line: `import { ${pkg.use.names.join(', ')} } from '${pkg.use.import}';` }
    : { inMain: false, line: `#include ${pkg.use.include}` });

export const canAddPackage = (project) => project.packages.length < MAX_PACKAGES;

// A package main.js imports gets its import line at the top of main.js, unless main.js imports it already.
export function addPackage(project, id) {
    const pkg = packageOf(id);
    if (!pkg || project.packages.includes(id) || !canAddPackage(project)) return project;
    const packages = [...project.packages, id];
    const main = project.files[MAIN] ?? '';
    if (!pkg.use.import || importSpecifiers(main).includes(pkg.use.import)) return { ...project, packages };
    return { files: { ...project.files, [MAIN]: `${usageOf(pkg).line}\n${main}` }, packages };
}

export const removePackage = (project, id) => ({ ...project, packages: project.packages.filter((other) => other !== id) });

const sorted = (list) => [...list].sort();

export const samePackages = (a, b) => sorted(a).join('\n') === sorted(b).join('\n');

export function sameProject(a, b) {
    const names = Object.keys(a.files);
    return names.length === Object.keys(b.files).length
        && names.every((name) => a.files[name] === b.files[name])
        && samePackages(a.packages, b.packages);
}

// main.js's import statements, spaced alike. A package header binds only the names main.js imports, so a module
// built for one set of imports serves another only when they are the same. One pass: each statement's text is read
// once, so a pasted page of `import` lines stays cheap.
export function importStatements(code) {
    const starts = /^[ \t]*import\b/gm;
    const gap = /[^;'"]*/y;
    const specifier = /(['"])[^'"\n]+\1/y;
    const statements = [];
    for (let start = starts.exec(code); start; start = starts.exec(code)) {
        gap.lastIndex = starts.lastIndex;
        gap.exec(code);
        specifier.lastIndex = gap.lastIndex;
        if (specifier.exec(code)) {
            statements.push(code.slice(start.index, specifier.lastIndex).trim().replace(/\s+/g, ' '));
            starts.lastIndex = specifier.lastIndex;
        } else {
            starts.lastIndex = gap.lastIndex + 1;
        }
    }
    return statements.sort();
}

// Whether a module built for `original` serves `project`: the same native files and packages, and main.js changed
// only below its import statements, with nothing imported anywhere else in it.
export function servesProject(project, original) {
    const withoutMain = ({ files, packages }) => ({ files: Object.fromEntries(Object.entries(files).filter(([name]) => name !== MAIN)), packages });
    const imports = (target) => {
        const main = target.files[MAIN] ?? '';
        return `${importStatements(main).join('\n')}\n${sorted(importSpecifiers(main)).join('\n')}`;
    };
    return sameProject(withoutMain(project), withoutMain(original)) && imports(project) === imports(original);
}
