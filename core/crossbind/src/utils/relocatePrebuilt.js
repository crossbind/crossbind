import fs from 'node:fs';
import upath from 'upath';

// pkg-config files, libtool archives, CMake configs and -config scripts record absolute paths of
// the machine that built them, so a published prebuilt only resolves there. These rewrites make
// every path relative to where the tree lands; whatever they cannot rewrite is left for the
// publish gate to report. Some upstream templates also name libstdc++, which no crossbind
// toolchain links: every one of them builds against libc++.

const PREFIX_VARIABLE = 'crossbind_prefix';
const ASSIGNMENT = /^(\s*[A-Za-z_][A-Za-z0-9_]*=)(.*)$/;
const SINGLE_QUOTED = /^'([^']*)'$/;
const DOUBLE_QUOTED = /^"((?:[^"\\]|\\.)*)"$/;
const BARE_WORD = /^[^\s'"\\]*$/;
const EXPANDS_IN_DOUBLE_QUOTES = /[$`"\\]/;
const PERMISSION_BITS = 0o7777;
const OWNER_WRITE = 0o200;
const LIBSTDCXX_FLAG = /(^|[\s"'=])-lstdc\+\+(?=[\s"']|$)/gm;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const nameLibcxx = (text) => text.replace(LIBSTDCXX_FLAG, '$1-lc++');

const replaceEach = (text, needles, replacement) => needles
    .reduce((result, needle) => result.replaceAll(needle, () => replacement), text);

// CMake installs programs without the owner write bit, so the rewrite borrows it and gives it back.
function rewrite(file, before, after) {
    if (before === after) return;
    const mode = fs.statSync(file).mode & PERMISSION_BITS;
    fs.chmodSync(file, mode | OWNER_WRITE);
    fs.writeFileSync(file, after);
    fs.chmodSync(file, mode);
}

function filesUnder(dir) {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => upath.join(entry.parentPath, entry.name));
}

const isUnder = (path, prefixes) => prefixes.some((prefix) => path.startsWith(prefix));

// Another package's files are only known by name once the tree leaves the build machine.
function nameForeignArchives(text, { installPrefixes, buildBases }, spell) {
    return buildBases.reduce((result, base) => result.replace(
        new RegExp(`${escapeRegExp(base)}/[^\\s'";]*?/lib/lib([\\w+.-]+)\\.a`, 'g'),
        (archive, name) => (isUnder(archive, installPrefixes) ? archive : spell(name)),
    ), text);
}

function dropForeignSearchPaths(text, { installPrefixes, buildBases }) {
    return buildBases.reduce((result, base) => result.replace(
        new RegExp(`\\s-[LI]${escapeRegExp(base)}/[^\\s'";]*`, 'g'),
        (flag) => (isUnder(flag.trim().slice(2), installPrefixes) ? flag : ''),
    ), text);
}

function relocatePkgConfig(file, prefixDir, paths) {
    const toPrefix = upath.relative(upath.dirname(file), prefixDir);
    const before = fs.readFileSync(file, 'utf8');
    const own = replaceEach(before, paths.installPrefixes, `\${pcfiledir}/${toPrefix}`);
    const foreign = nameForeignArchives(dropForeignSearchPaths(own, paths), paths, (name) => `-l${name}`);
    rewrite(file, before, nameLibcxx(foreign));
}

function relocateCMake(file, paths) {
    const before = fs.readFileSync(file, 'utf8');
    rewrite(file, before, nameForeignArchives(before, paths, (name) => name));
}

// The text of an assignment value as it reads between double quotes, or null when its quoting
// is anything but one plain word.
function doubleQuotedContent(value) {
    const single = SINGLE_QUOTED.exec(value);
    if (single) return EXPANDS_IN_DOUBLE_QUOTES.test(single[1]) ? null : single[1];
    const double = DOUBLE_QUOTED.exec(value);
    if (double) return double[1];
    return BARE_WORD.test(value) ? value : null;
}

function relocateAssignment(line, installPrefixes) {
    const match = ASSIGNMENT.exec(line);
    if (!match || !installPrefixes.some((prefix) => line.includes(prefix))) return line;
    const content = doubleQuotedContent(match[2]);
    if (content === null) return line;
    return `${match[1]}"${replaceEach(content, installPrefixes, `\${${PREFIX_VARIABLE}}`)}"`;
}

function relocateConfigScript(file, prefixDir, installPrefixes) {
    const before = fs.readFileSync(file, 'utf8');
    const lines = before.split('\n');
    if (!/^#!.*sh/.test(lines[0])) return;
    const relocated = lines.map((line) => relocateAssignment(line, installPrefixes));
    const isPrefixRelocated = relocated.some((line, index) => line !== lines[index]);
    const toPrefix = upath.relative(upath.dirname(file), prefixDir);
    const definition = `${PREFIX_VARIABLE}=$(cd "$(dirname "$0")/${toPrefix}" && pwd)`;
    const after = isPrefixRelocated ? [relocated[0], definition, ...relocated.slice(1)] : relocated;
    rewrite(file, before, nameLibcxx(after.join('\n')));
}

const isConfigScript = (file) => file.endsWith('-config') && upath.basename(upath.dirname(file)) === 'bin';

export default function relocatePrebuilt(prefixDir, paths) {
    filesUnder(prefixDir).forEach((file) => {
        if (file.endsWith('.la')) fs.rmSync(file);
        else if (file.endsWith('.pc')) relocatePkgConfig(file, prefixDir, paths);
        else if (file.endsWith('.cmake')) relocateCMake(file, paths);
        else if (isConfigScript(file)) relocateConfigScript(file, prefixDir, paths.installPrefixes);
    });
}
