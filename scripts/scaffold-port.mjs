#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ROOT = path.join(ROOT, 'ports', 'zlib');
const SKIP_DIRECTORIES = new Set(['.crossbind', 'dist', 'node_modules']);
const BINARY_FILE = /\.(?:a|dylib|gif|jpg|png|so|tgz|wasm|xcframework|zip)$/i;

function validateName(name) {
    if (!/^[a-z][a-z0-9-]*$/.test(name ?? '')) {
        throw new Error('port name must match [a-z][a-z0-9-]*');
    }
}

export function parseArguments(args) {
    const parsed = {
        name: null,
        lib: null,
        license: 'MIT',
        force: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--') continue;
        if (argument === '--force') {
            parsed.force = true;
            continue;
        }
        if (argument === '--lib' || argument === '--license') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
            if (argument === '--lib') parsed.lib = value;
            else parsed.license = value;
            index += 1;
            continue;
        }
        if (argument.startsWith('--')) throw new Error(`unknown option: ${argument}`);
        if (parsed.name) throw new Error(`unexpected argument: ${argument}`);
        parsed.name = argument;
    }

    parsed.lib ??= parsed.name;
    return parsed;
}

function rewritePackage(content, { name, license }) {
    const pkg = JSON.parse(content);
    if (pkg.name) pkg.name = pkg.name.replace('port-zlib', `port-${name}`);
    if ('version' in pkg) pkg.version = '0.1.0';
    if ('nativeVersion' in pkg) pkg.nativeVersion = 'TODO';
    if (pkg.license) pkg.license = license;
    if (pkg.description) pkg.description = pkg.description.replaceAll('zlib', name).replaceAll('Zlib', name);
    if (pkg.homepage) pkg.homepage = pkg.homepage.replace('/ports/zlib', `/ports/${name}`);
    if (Array.isArray(pkg.keywords)) {
        pkg.keywords = [...new Set(pkg.keywords.filter((keyword) => !['zlib', 'libz'].includes(keyword)).concat(name))];
    }
    for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        if (!pkg[group]) continue;
        for (const dependency of Object.keys(pkg[group])) {
            if (!dependency.startsWith('@crossbind/port-zlib')) continue;
            const renamed = dependency.replace('port-zlib', `port-${name}`);
            pkg[group][renamed] = pkg[group][dependency];
            delete pkg[group][dependency];
        }
    }
    if (pkg.crossbind?.upstream?.license) {
        pkg.crossbind.upstream.license = {
            declared: license,
            selected: null,
            files: ['LICENSE'],
            copyright: null,
        };
    }
    return `${JSON.stringify(pkg, null, 4)}\n`;
}

function rewriteText(content, { name, lib }) {
    return content
        .replaceAll('port-zlib', `port-${name}`)
        .replaceAll('ports/zlib', `ports/${name}`)
        .replaceAll('libz.a', `lib${lib}.a`)
        .replaceAll('libz.so', `lib${lib}.so`)
        .replaceAll('z.xcframework', `${lib}.xcframework`)
        .replaceAll("'z'", `'${lib}'`)
        .replaceAll('"z"', `"${lib}"`)
        .replaceAll('zlib', name)
        .replaceAll('Zlib', name);
}

function placeholderBuild({ name }) {
    return `export default {\n    // TODO: pin ${name}'s source archive and SHA-256 before building.\n    sha256: 'TODO',\n    getURL: (version) => {\n        throw new Error(\`Set the upstream URL for ${name} \${version}\`);\n    },\n    buildType: 'cmake',\n    getBuildParams: () => [],\n};\n`;
}

function placeholderLicense({ name, license }) {
    return `TODO: replace this file with the complete upstream ${name} license text (${license}).\n`;
}

function copyTemplate(source, destination, options) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (entry.isDirectory() && (SKIP_DIRECTORIES.has(entry.name) || entry.name.endsWith('.xcframework'))) continue;
        const sourcePath = path.join(source, entry.name);
        const destinationName = entry.name.replaceAll('port-zlib', `port-${options.name}`);
        const destinationPath = path.join(destination, destinationName);
        if (entry.isDirectory()) {
            copyTemplate(sourcePath, destinationPath, options);
        } else if (entry.isFile() && BINARY_FILE.test(entry.name)) {
            fs.copyFileSync(sourcePath, destinationPath);
        } else if (entry.isFile()) {
            const content = fs.readFileSync(sourcePath, 'utf8');
            const relative = path.relative(options.templateRoot, sourcePath);
            const rewritten = entry.name === 'package.json'
                ? rewritePackage(content, options)
                : entry.name === 'LICENSE'
                    ? placeholderLicense(options)
                    : relative === path.join('base', 'build.mjs')
                        ? placeholderBuild(options)
                        : rewriteText(content, options);
            fs.writeFileSync(destinationPath, rewritten);
        }
    }
}

export function scaffoldPort({
    name,
    lib = name,
    license = 'MIT',
    force = false,
    root = ROOT,
    templateRoot = TEMPLATE_ROOT,
}) {
    validateName(name);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(lib)) throw new Error('library name contains unsupported characters');
    const destination = path.join(root, 'ports', name);
    if (fs.existsSync(destination) && !force) throw new Error(`ports/${name} already exists; pass --force to replace it`);
    if (force) fs.rmSync(destination, { recursive: true, force: true });
    copyTemplate(templateRoot, destination, { name, lib, license, templateRoot });
    return destination;
}

function main(args) {
    const options = parseArguments(args);
    const destination = scaffoldPort(options);
    process.stdout.write([
        `Scaffolded @crossbind/port-${options.name} at ${path.relative(ROOT, destination)}.`,
        'Next: update every target recipe, upstream metadata and license, then build each claimed target.',
    ].join('\n') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`scaffold-port: ${error.message}\n`);
        process.exitCode = 1;
    }
}
