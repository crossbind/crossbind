import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function sha512Integrity(file) {
    return `sha512-${crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')}`;
}

export function inspectWorkspaceTarball({ tarball, expectedName, expectedVersion, run = execFileSync }) {
    const absolute = path.resolve(tarball);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Workspace release tarball does not exist: ${absolute}`);
    let manifest;
    try {
        manifest = JSON.parse(run('tar', ['-xOf', absolute, 'package/package.json'], { encoding: 'utf8' }));
    } catch (error) {
        throw new Error(`Cannot read package/package.json from ${absolute}: ${error.message}`, { cause: error });
    }
    if (manifest.name !== expectedName || manifest.version !== expectedVersion) {
        throw new Error(
            `${absolute}: packed identity is ${manifest.name ?? '(missing)'}@${manifest.version ?? '(missing)'}, ` +
                `expected ${expectedName}@${expectedVersion}.`,
        );
    }
    const workspaceReferences = ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
        Object.entries(manifest[field] ?? {})
            .filter(([, range]) => String(range).startsWith('workspace:'))
            .map(([name]) => `${field}.${name}`),
    );
    if (workspaceReferences.length) {
        throw new Error(`${absolute}: pnpm did not resolve workspace protocol references: ${workspaceReferences.join(', ')}.`);
    }
    return { tarball: absolute, integrity: sha512Integrity(absolute), manifest };
}

export function packWorkspacePackage({ root, packagePath, expectedName, expectedVersion, artifactDirectory, run = execFileSync }) {
    fs.mkdirSync(artifactDirectory, { recursive: true });
    const packageDirectory = path.resolve(root, packagePath);
    const packed = JSON.parse(
        run('pnpm', ['--dir', packageDirectory, 'pack', '--json', '--pack-destination', artifactDirectory], {
            cwd: root,
            encoding: 'utf8',
            env: npmCacheEnvironment(),
            maxBuffer: 64 * 1024 * 1024,
        }),
    );
    if (packed?.name !== expectedName || packed?.version !== expectedVersion || !packed?.filename) {
        throw new Error(`pnpm pack returned an unexpected result for ${expectedName}@${expectedVersion}: ${JSON.stringify(packed)}`);
    }
    return { ...inspectWorkspaceTarball({ tarball: packed.filename, expectedName, expectedVersion, run }), pack: packed };
}

export function inspectCrossbindTarball(tarball) {
    const absolute = path.resolve(tarball);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        throw new Error(`Crossbind release tarball does not exist: ${absolute}`);
    }
    return { tarball: absolute, integrity: sha512Integrity(absolute) };
}

function npmCacheEnvironment() {
    return {
        ...process.env,
        NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? path.join(os.tmpdir(), 'crossbind-npm-cache'),
    };
}

export function packCrossbind({ root, artifactDirectory }) {
    fs.mkdirSync(artifactDirectory, { recursive: true });
    const packed = JSON.parse(
        execFileSync('npm', ['pack', path.join(root, 'core', 'crossbind'), '--json', '--pack-destination', artifactDirectory], {
            cwd: root,
            encoding: 'utf8',
            env: npmCacheEnvironment(),
            maxBuffer: 16 * 1024 * 1024,
        }),
    );
    if (!Array.isArray(packed) || packed.length !== 1 || !packed[0].filename) {
        throw new Error(`npm pack returned an unexpected result: ${JSON.stringify(packed)}`);
    }
    const tarball = path.join(artifactDirectory, packed[0].filename);
    return { tarball, integrity: sha512Integrity(tarball), pack: packed[0] };
}

function publicInstallEnvironment(directory) {
    const environment = npmCacheEnvironment();
    for (const name of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) delete environment[name];
    const userConfig = path.join(directory, 'empty-user-npmrc');
    fs.writeFileSync(userConfig, 'registry=https://registry.npmjs.org\n');
    environment.NPM_CONFIG_USERCONFIG = userConfig;
    environment.npm_config_userconfig = userConfig;
    return environment;
}

export function smokeTestCrossbindTarball({ tarball, expectedVersion, temporaryRoot, run = execFileSync }) {
    const artifact = inspectCrossbindTarball(tarball);
    const ownsTemporaryRoot = !temporaryRoot;
    const directory = temporaryRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-tarball-smoke-'));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
        path.join(directory, 'package.json'),
        `${JSON.stringify({ name: 'crossbind-release-smoke', private: true, version: '0.0.0' }, null, 2)}\n`,
    );
    const environment = publicInstallEnvironment(directory);
    const options = { cwd: directory, encoding: 'utf8', env: environment, maxBuffer: 16 * 1024 * 1024 };

    try {
        run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', artifact.tarball], options);
        const installedRoot = path.join(directory, 'node_modules', 'crossbind');
        const installedManifest = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
        if (installedManifest.name !== 'crossbind' || installedManifest.version !== expectedVersion) {
            throw new Error(
                `Installed tarball identity is ${installedManifest.name}@${installedManifest.version}, ` + `expected crossbind@${expectedVersion}.`,
            );
        }

        const cliVersion = run(process.execPath, [path.join(installedRoot, 'src', 'bin.js'), '--version'], options).trim();
        if (cliVersion !== expectedVersion) {
            throw new Error(`Installed crossbind CLI reports ${cliVersion || '(empty)'}, expected ${expectedVersion}.`);
        }

        const smokeModule = [
            "const api = await import('crossbind');",
            "if (typeof api.getContentHash !== 'function') throw new Error('top-level ESM API did not load');",
            "const images = await import('crossbind/src/utils/pullDockerImage.js');",
            "const web = images.getDockerImage('web');",
            "const android = images.getDockerImage('android', 'linux/amd64');",
            'if (!/^ghcr\\.io\\/crossbind\\/web@sha256:[0-9a-f]{64}$/.test(web)) throw new Error(`bad web digest ref: ${web}`);',
            'if (!/^ghcr\\.io\\/crossbind\\/android@sha256:[0-9a-f]{64}$/.test(android)) throw new Error(`bad android digest ref: ${android}`);',
        ].join('\n');
        run(process.execPath, ['--input-type=module', '--eval', smokeModule], options);
        return { ...artifact, package: installedManifest.name, version: installedManifest.version };
    } finally {
        if (ownsTemporaryRoot) fs.rmSync(directory, { recursive: true, force: true });
    }
}
