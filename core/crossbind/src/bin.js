#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { Option } from 'commander';

import { state } from './index.js';
import { addSystemCommands, createProgram, handleFatal } from './program.js';
import createLib from './actions/createLib.js';
import buildWasm from './actions/buildWasm.js';
import buildWasiCommand from './actions/buildWasiCommand.js';
import buildNode, { addonsInPackages, bundleNodeLoader, publishNodeData } from './actions/buildNode.js';
import buildNativeCommand from './actions/buildNativeCommand.js';
import buildApp, { appOutputPath, assertAppRunner, publishApp } from './actions/buildApp.js';
import { machineUploadKey, releaseSigning, uploadKeyEnv } from './actions/androidGradle.js';
import { UPDATER_KEY, newUpdaterKey } from './actions/appUpdate.js';
import { makeUploadKey, showUploadKeyPassword, useUploadKey } from './actions/uploadKey.js';
import { askHidden, hasTerminal } from './utils/ask.js';
import buildExternal from './actions/buildExternal.js';
import buildPackageTypes from './actions/buildTypes.js';
import buildLib from './actions/buildLib.js';
import buildDependencies from './actions/buildDependencies.js';
import writeRuntimeEntry, { removeImportHooks, writeImportHooks, writeImportManifest } from './actions/writeRuntimeEntry.js';
import { bindsAppImports, createImportedBridges, findAppNativeImports } from './actions/createImportedBridges.js';
import { nativeExtensions } from './utils/nativeImports.js';
import { createBridges, createNativeBridges } from './actions/nativeBridges.js';
import { ENTRY_RUNTIMES } from './utils/runtimeEntries.js';
import { publishNativeCommand, publishNodeAddon, publishWasiCommand } from './actions/publishBinary.js';
import runCrossbindApp from './actions/run.js';
import { getBuildTargets, getFilteredBuildTargets } from './actions/target.js';
import { OPT_IN_PLATFORMS, selectRuntimeEnvs } from './utils/targets.js';
import { resolveHostPlatform } from './utils/hostPlatform.js';
import resolveEmbindNapiRoot, { resolveEmbindJsiRoot } from './utils/resolveEmbindNapi.js';

import logger from './utils/logger.js';
import { getDockerImage, getDockerContainerName } from './utils/pullDockerImage.js';
import {
    RUNNER_PLATFORMS, RUNNER_ROLES, connectCommands, deleteRunner, deploySteps, initRunner, newRunnerToken, runnerHostPort, startRunner,
} from './actions/runnerCommands.js';
import { cargoHome } from './utils/runCargo.js';
import { conanRoot } from './utils/runConan.js';
import { cleanDepsCache } from './utils/dependencyRebuild.js';
import collectLicenseRows from './actions/licenses.js';
import { formatNoticesMarkdown, formatCycloneDxSbom, validateSpdx } from './utils/licenseReport.js';
import { SBOM_FILE, nodePackageMeta, writeNodePackageLicense } from './utils/packageLicense.js';
import findFiles from './utils/findFiles.js';

const platforms = [...new Set(state.targets.map(target => target.platform).filter(t => t))];
const archs = [...new Set(state.targets.map(target => target.arch).filter(t => t))];
const runtimes = [...new Set(state.targets.map(target => target.runtime).filter(t => t))];
const buildTypes = [...new Set(state.targets.map(target => target.buildType).filter(t => t))];
const runtimeEnvs = [...new Set(state.targets.map(target => target.runtimeEnv).filter(t => t))];

process.on('uncaughtException', handleFatal);
process.on('unhandledRejection', handleFatal);

const program = createProgram();

program.command('build')
    .description('compile the project that was set up using crossbind')
    .addOption(new Option('-p, --platform <platform>', 'target platform (host: the one of this machine)').argParser(createListParser(platforms, resolveHostPlatform)))
    .addOption(new Option('-a, --arch <arch>', 'target architecture').argParser(createListParser(archs)))
    .addOption(new Option('-r, --runtime <runtime>', 'target runtime').argParser(createListParser(runtimes)))
    .addOption(new Option('-b, --build-type <buildType>', 'target build type').argParser(createListParser(buildTypes)))
    .addOption(new Option('-e, --runtime-env <runtimeEnv>', 'binaries to make, by runtime environment (without it, only the archives are built)').argParser(createListParser(runtimeEnvs)))
    .option('--rebuild-deps [list]', 'rebuild dependencies from source instead of using prebuilt (all, or a comma-separated list of names)')
    .option('--bind-imports', "also bind what the app's JavaScript imports into browser binaries (node binaries always do), for a page that resolves those imports itself")
    .action((options) => {
        const { rebuildDeps, bindImports, ...rest } = options;
        const targetParams = { ...rest };

        if (!targetParams.arch) {
            targetParams.arch = archs.filter(item => item !== 'wasm64');
        }
        if (!targetParams.buildType) {
            targetParams.buildType = ['release'];
        }

        targetParams.platform = targetParams.platform || platforms.filter((item) => !OPT_IN_PLATFORMS.includes(item));
        targetParams.arch = targetParams.arch || archs;
        targetParams.runtime = targetParams.runtime || runtimes;
        targetParams.buildType = targetParams.buildType || buildTypes;
        const binaryRuntimeEnvs = selectRuntimeEnvs(targetParams.runtimeEnv, state.config.target.runtimeEnv);
        // The archives do not depend on the runtime environment; only the binaries do.
        targetParams.runtimeEnv = runtimeEnvs;

        if (state.config.build.withBuildConfig) {
            buildExternal(targetParams);
        } else {
            // An app builds only for the platforms -p names, so a plain build keeps making the archives alone.
            build(targetParams, rebuildDeps, binaryRuntimeEnvs, { bindImports }, rest.platform ?? []);
        }
    });

// The path a package publishes its SBOM at, as recorded for the publish gate. Absent for ordinary
// projects, which keep the plain default.
function declaredSbomPath(projectDir) {
    try {
        const manifest = JSON.parse(fs.readFileSync(`${projectDir}/package.json`, 'utf8'));
        return manifest.crossbind?.provenance?.sbom ?? null;
    } catch {
        return null;
    }
}

// An app's page is the project's Vite build, which @crossbind/plugin-vite makes into the app of the platform named.
const APP_PLATFORMS = ['android', 'ios', 'linux', 'macos', 'windows'];

function projectVite() {
    try {
        const manifest = createRequire(`${state.config.paths.project}/package.json`).resolve('vite/package.json');
        return path.join(path.dirname(manifest), JSON.parse(fs.readFileSync(manifest, 'utf8')).bin.vite);
    } catch {
        throw new Error("crossbind: crossbind app builds the app's page with the project's Vite, which the project does not have. Add vite and @crossbind/plugin-vite to it, as the desktop-app template has them.");
    }
}

// An Android release signs with the environment's upload key, else this machine's, whose password the keychain keeps or
// the terminal gives; Vite's build gets it in its environment.
async function androidReleaseEnv() {
    const key = machineUploadKey();
    const password = key && !key.password && hasTerminal() ? await askHidden(`Password of this machine's upload key, ${key.keystore}: `) : null;
    const env = key ? uploadKeyEnv({ ...key, password: key.password || password }) : {};
    releaseSigning({ ...process.env, ...env });
    return env;
}

const commandApp = program.command('app').description('build the project as an app, or open it on the dev server');
[
    ['dev', 'open the app on the dev server, and open it anew as its native code changes'],
    ['build', 'build the app with its page: for Android also its APK, and with an upload key its bundle'],
].forEach(([name, description]) => commandApp.command(name).description(description)
    .addOption(new Option('-p, --platform <platform>', "the app's platform (default: CROSSBIND_APP_PLATFORM, else this machine's)").choices(APP_PLATFORMS))
    // Vite's own options, as --port or --mode, go on to Vite.
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async ({ platform }, command) => {
        if (state.config.target.runtimeEnv !== 'app') {
            throw new Error("crossbind: crossbind app builds an app, which this project is not: set target: { runtimeEnv: 'app' } in crossbind.config.js, as the desktop-app template does.");
        }
        // An Android build checks its upload key before the native build, not after it.
        const signing = name === 'build' && (platform ?? process.env.CROSSBIND_APP_PLATFORM) === 'android' ? await androidReleaseEnv() : {};
        const vite = spawn(process.execPath, [projectVite(), ...(name === 'build' ? ['build'] : []), ...command.args], {
            stdio: 'inherit',
            cwd: state.config.paths.project,
            env: { ...process.env, ...signing, ...(platform ? { CROSSBIND_APP_PLATFORM: platform } : {}) },
        });
        // A signal sent to crossbind alone reaches Vite too, which ends through its exit hooks; Ctrl-C reaches both.
        ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => process.prependListener(signal, () => vite.kill(signal)));
        vite.on('exit', (code, signal) => process.exit(code ?? 128 + os.constants.signals[signal]));
    }));

commandApp.command('updater-key')
    .description("make the key pair that signs a desktop app's updates")
    .action(() => {
        const { publicKey, privateKey } = newUpdaterKey();
        console.log(`crossbind: app.updater.publicKey in crossbind.config.js: ${publicKey}`);
        console.log(`crossbind: ${UPDATER_KEY}, kept secret where the app is built: ${privateKey}`);
    });

commandApp.command('upload-key')
    .description("make this machine's upload key, which signs an Android app's bundle for Google Play")
    .option('--use <keystore>', 'make a key you have the upload key instead, once it opens with its password')
    .option('--alias <alias>', 'the alias of the key in the keystore --use names', 'upload')
    .option('--no-keychain', 'keep the password in no keychain, so builds ask for it')
    .option('--show-password', 'print the password the keychain keeps, for another machine or CI')
    .action(async ({ use, alias, keychain, showPassword }) => {
        if (showPassword) showUploadKeyPassword();
        else if (use) await useUploadKey(use, { alias, isKeychain: keychain });
        else await makeUploadKey({ isKeychain: keychain });
    });

program.command('licenses')
    .description('list bundled native dependencies with SPDX license, versions and source URL')
    .option('--notices [file]', 'write a THIRD-PARTY-NOTICES markdown file (default: THIRD-PARTY-NOTICES.md)')
    .option('--sbom [file]', 'write a CycloneDX SBOM json file (default: sbom.cdx.json)')
    .option('--check', 'exit non-zero when a license field is missing or not valid SPDX')
    .option('--platform <platform>', "also list what this platform's artifact statically links beyond the package graph (vendored copies, toolchain runtime)")
    .addOption(new Option('-e, --runtime-env <runtimeEnv>', "also list the crossbind runtime an addon of --platform compiles in (without --platform the one its loader bundles), or what an app's host carries").choices(['node', 'app']))
    .option('--json [file]', 'write the rows, license texts included, as JSON (default: licenses.json)')
    .option('--package', "write this Node-API package's LICENSE, sbom.cdx.json and package.json license field (with -e node)")
    .action(async (options) => {
        if (options.package && options.runtimeEnv !== 'node') {
            throw new Error('crossbind licenses --package writes the license files of a Node-API package; pass -e node.');
        }
        const rows = await collectLicenseRows(options.platform || null, { runtimeEnv: options.runtimeEnv || null });
        rows.forEach((row) => {
            console.log(`${row.isCopyleft ? '! ' : '  '}${(row.name || '').padEnd(14)} ${String(row.license || '(missing)').padEnd(48)} native ${String(row.nativeVersion || '-').padEnd(10)} ${row.sourceUrl || ''}`);
        });
        const copyleftRows = rows.filter((row) => row.isCopyleft);
        if (copyleftRows.length > 0) {
            console.log(`\n! ${copyleftRows.length} copyleft-licensed ${copyleftRows.length === 1 ? 'dependency' : 'dependencies'} (${copyleftRows.map((row) => row.name).join(', ')}) — see docs/playbooks/licensing-lgpl.md`);
        }
        if (options.notices) {
            const file = typeof options.notices === 'string' ? options.notices : `${state.config.paths.project}/THIRD-PARTY-NOTICES.md`;
            fs.writeFileSync(file, formatNoticesMarkdown(rows));
            logger.info(`crossbind: wrote ${file}`);
        }
        if (options.sbom) {
            // Without a path, write where the package says its SBOM lives. A -bin package declares
            // that in crossbind.provenance.sbom and the publish gate checks exactly that path, so
            // taking it from there is what keeps `--sbom` from needing the path spelled out again
            // in every package - and from disagreeing with the gate when one of them is edited.
            const file = typeof options.sbom === 'string'
                ? options.sbom
                : `${state.config.paths.project}/${declaredSbomPath(state.config.paths.project) ?? 'sbom.cdx.json'}`;
            const target = { name: state.config.package?.name, version: state.config.package?.version };
            fs.writeFileSync(file, formatCycloneDxSbom(rows, target));
            logger.info(`crossbind: wrote ${file}`);
        }
        if (options.json) {
            const file = typeof options.json === 'string' ? options.json : `${state.config.paths.project}/licenses.json`;
            fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
            logger.info(`crossbind: wrote ${file}`);
        }
        if (options.package) {
            const expression = writeNodePackageLicense(state.config.paths.project, { ...nodePackageMeta(state.config), rows });
            logger.info(`crossbind: wrote LICENSE and ${SBOM_FILE} (${expression})`);
        }
        if (options.check) {
            const invalid = rows
                .map((row) => ({ row, result: validateSpdx(row.license) }))
                .filter(({ result }) => !result.isValid);
            invalid.forEach(({ row, result }) => console.error(`x ${row.name} (${row.npmName}): ${result.error}`));
            if (invalid.length > 0) process.exit(1);
            console.log('✓ all license fields are valid SPDX');
        }
    });

program.command('clean-deps')
    .description('remove the source-rebuilt dependency cache (all, or only the named dependencies)')
    .argument('[names...]', 'dependency names (general name, package name or alias)')
    .action((names) => {
        const dirNames = names.length === 0 ? undefined : names.map((given) => {
            const match = state.config.allDependencies.find((d) => [
                d.general?.name, d.package?.name, d.general?.alias?.package,
            ].filter(Boolean).includes(given));
            return match ? match.general.name : given;
        });
        const removed = cleanDepsCache(state.config.paths.cache, dirNames);
        if (removed.length === 0) {
            logger.info('crossbind: no rebuilt dependency cache to remove.');
        } else {
            logger.info(`crossbind: removed rebuilt cache for: ${removed.join(', ')}.`);
        }
    });

// A container belongs to one image: the web container carries no NDK, and android runs a forced platform.
const IMAGE_ROLES = ['web', 'android', 'android-app', 'linux', 'windows'];
const dockerContainerName = (role) => {
    if (!IMAGE_ROLES.includes(role)) {
        console.error(`crossbind: unknown image "${role}" - expected one of ${IMAGE_ROLES.join(', ')}.`);
        process.exit(1);
    }
    return getDockerContainerName(state.config.paths.base, role);
};

const dockerExec = (args) => {
    try {
        execFileSync('docker', args, { stdio: 'inherit' });
    } catch (e) {
        console.error(`crossbind: docker command failed with exit code ${e?.status ?? 'unknown'}.`);
        process.exit(e?.status || 1);
    }
};

const commandDocker = program.command('docker').description('manage docker');

commandDocker.command('run')
    .description('run docker application')
    .argument('<program>', 'program to execute inside the container')
    .argument('[params...]', 'arguments passed to the program')
    .action((programName, params) => run(programName, params));

const imageArgument = (command) => command.argument('[image]', `image to act on (${IMAGE_ROLES.join(', ')})`, 'web');

imageArgument(commandDocker.command('create').description('create docker container'))
    .action((image) => {
        // Google ships the linux NDK for x86_64 only, so an android or android-app container is always amd64.
        const platform = ['android', 'android-app'].includes(image) ? 'linux/amd64' : undefined;
        // Docker on Linux makes a missing mount source owned by root, which the user's builds cannot write.
        [cargoHome(), conanRoot()].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
        dockerExec([
            'run', '-dit',
            ...(platform ? ['--platform', platform] : []),
            '--name', dockerContainerName(image),
            '-v', `${state.config.paths.base}:/tmp/crossbind/live`,
            // Cargo's registry cache, shared with host builds and with every other project, and the
            // Conan store and work directories every other container build uses.
            '-v', `${cargoHome()}:/var/cache/crossbind/cargo`,
            '-v', `${conanRoot()}:/var/cache/crossbind/conan`,
            getDockerImage(image, platform),
            'bash',
        ]);
    });

imageArgument(commandDocker.command('start').description('start docker container'))
    .action((image) => dockerExec(['start', dockerContainerName(image)]));

imageArgument(commandDocker.command('stop').description('stop docker container'))
    .action((image) => dockerExec(['stop', dockerContainerName(image)]));

imageArgument(commandDocker.command('delete').description('delete docker container'))
    .action((image) => dockerExec(['rm', dockerContainerName(image)]));

const runnerAction = (fn) => (...args) => {
    try {
        fn(...args);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
};
const roleOption = () => new Option('--role <role>', 'toolchain image the runner serves').choices(RUNNER_ROLES).default('web');

const commandRunner = program.command('runner')
    .description('run the remote build runner that RUNNER=REMOTE sends builds to');

commandRunner.command('start')
    .description('start a runner in local docker, from the toolchain image this CLI pins')
    .addOption(roleOption())
    .option('--port <port>', `host port (default: ${RUNNER_ROLES.map((role) => `${runnerHostPort(role)} for ${role}`).join(', ')})`)
    .option('--host <address>', 'host address to listen on', '127.0.0.1')
    .option('--token <token>', 'token builds must send (default: $CROSSBIND_RUNNER_TOKEN, else a new one)')
    .action(runnerAction((options) => {
        const runner = startRunner({
            role: options.role, port: options.port && Number(options.port), host: options.host, token: options.token,
        });
        console.log(`crossbind: ${runner.name} is running. Build against it with:`);
        connectCommands(options.role, runner.url, runner.displayToken).forEach((line) => console.log(`  ${line}`));
    }));

commandRunner.command('delete')
    .description('stop and delete the local runner')
    .addOption(roleOption())
    .action(runnerAction((options) => deleteRunner({ role: options.role })));

commandRunner.command('init')
    .description('write a folder that deploys a runner to a hosting platform')
    .argument('<platform>', `hosting platform (${RUNNER_PLATFORMS.join(', ')})`)
    .addOption(roleOption())
    .option('--dir <dir>', 'folder to write (default: crossbind-runner-<platform>-<role>)')
    .option('--vcpu <count>', 'cloudflare: vCPUs of the container (1-4), with the least memory Cloudflare allows them (default: standard-4)')
    .action(runnerAction((platform, options) => {
        const { dir, url } = initRunner({
            platform,
            role: options.role,
            dir: options.dir ?? `crossbind-runner-${platform}-${options.role}`,
            vcpu: options.vcpu === undefined ? undefined : Number(options.vcpu),
        });
        console.log(`crossbind: wrote ${dir}. Deploy it:`);
        deploySteps(platform, dir, newRunnerToken(), options.role, url).forEach((step) => console.log(`  ${step}`));
    }));

addSystemCommands(program);

// `pnpm run <script> -- --flag` forwards the `--` literally and commander would then
// treat the flags as positionals. Strip the first separator for commands where every
// argument is an option; `run`/`docker run` keep it for program arguments.
const argv = [...process.argv];
if (['build', 'clean-deps', 'licenses'].includes(argv[2])) {
    const separatorIndex = argv.indexOf('--');
    if (separatorIndex !== -1) argv.splice(separatorIndex, 1);
}

program.parse(argv);

function run(programName, params) {
    runCrossbindApp(programName, params, null, null, { console: true });
}

// A package whose platform packages link its addons, building nothing else, has no archive of its own that
// anything links.
function onlyLoadsPackagedAddons(binaryParams) {
    if (binaryParams.runtimeEnv.length === 0) return false;
    const targets = getBuildTargets(binaryParams);
    return targets.every((target) => target.runtimeEnv === 'node' && target.platform !== 'wasm') && addonsInPackages();
}

async function build(targetParams, rebuildOption, binaryRuntimeEnvs, wasmOptions = {}, appPlatforms = []) {
    await buildDependencies({ targetParams, rebuildOption });
    const binaryParams = { ...targetParams, runtimeEnv: binaryRuntimeEnvs };
    if (!onlyLoadsPackagedAddons(binaryParams)) {
        // An app links its archives into itself, so it publishes no xcframework or podspec of them.
        buildLib(targetParams, { skipXcframework: binaryRuntimeEnvs.includes('app') });
    }
    if (binaryRuntimeEnvs.length === 0) {
        logger.info(`crossbind: no runtime environment was selected, so only the archives were built - pass -e (${runtimeEnvs.join(', ')}) for a binary.`);
    } else {
        await createWasmJs(binaryParams, wasmOptions);
        await createNodeAddons(binaryParams);
        await createNativeCommands(binaryParams);
        await createApps({ ...binaryParams, platform: appPlatforms });
        await createWasiCommands(binaryParams);
    }
    buildPackageTypes();
}

async function createNativeCommands(targetParams) {
    const targets = getBuildTargets(targetParams).filter((target) => target.runtimeEnv === 'native');
    for (const target of targets) {
        const distCommand = `${state.config.paths.output}/${target.commandName}`;
        const built = await buildNativeCommand(target, { force: !fs.existsSync(distCommand) });
        publishNodeData(target, { refresh: built });
        if (!built) {
            continue;
        }
        publishNativeCommand(target);
    }
}

// An app built without a bundler has no page; the Vite plugin puts one in.
async function createApps(targetParams) {
    const targets = getBuildTargets(targetParams).filter((target) => target.runtimeEnv === 'app');
    if (targets.length === 0) {
        return;
    }
    targets.forEach(assertAppRunner);
    const bridges = createNativeBridges(targets).headers.flatMap((header) => header.bridge ?? []);
    // An iOS or Android app is one project for all its SDKs or ABIs, written once they are built, and every time, as it
    // also takes the app's identity and the host package's template.
    const projects = new Map();
    for (const target of targets) {
        const isProject = ['ios', 'android'].includes(target.platform);
        const built = await buildApp(target, { bridges, force: !isProject && !fs.existsSync(appOutputPath(target)) });
        if (isProject) projects.set(appOutputPath(target), target);
        else if (built) publishApp(target);
    }
    projects.forEach((target) => publishApp(target));
}

async function createWasiCommands(targetParams) {
    const targets = getFilteredBuildTargets(targetParams, { platform: 'wasi' });
    if (targets.length === 0) {
        return;
    }
    for (const target of targets) {
        const distWasm = `${state.config.paths.output}/${target.wasmName}`;
        const built = await buildWasiCommand(target, { force: !fs.existsSync(distWasm) });
        if (!built) {
            continue;
        }
        publishWasiCommand(target);
    }
}

// A package whose platform packages link its addons ships what loads them: the loader and the data.
async function publishLoaders(targets) {
    fs.mkdirSync(state.config.paths.output, { recursive: true });
    targets.forEach((target) => publishNodeData(target, { refresh: true }));
    for (const target of new Map(targets.map((t) => [t.jsName, t])).values()) {
        await bundleNodeLoader(target);
        fs.copyFileSync(`${state.config.paths.build}/${target.jsName}`, `${state.config.paths.output}/${target.jsName}`);
    }
}

async function createNodeAddons(targetParams) {
    const targets = getBuildTargets(targetParams)
        .filter((target) => target.runtimeEnv === 'node' && target.platform !== 'wasm');
    if (targets.length === 0) {
        return;
    }
    // The bridges compile against the embind runtime, which speaks JSI.
    const headerDirs = [
        `${resolveEmbindJsiRoot()}/cpp/src`,
        `${resolveEmbindNapiRoot()}/third_party/node-api-jsi/jsi`,
    ];
    const { headers, imports } = createNativeBridges(targets);
    const opt = {
        buildSource: false,
        nativeGlob: [
            `${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`,
            ...headers.flatMap((header) => header.bridge ?? []),
        ],
        headerDirs,
        inputs: headerDirs.flatMap((dir) => findFiles('**/*.h', { cwd: dir })),
    };

    if (addonsInPackages()) {
        await publishLoaders(targets);
    } else {
        for (const target of targets) {
            const distComplete = fs.existsSync(`${state.config.paths.output}/${target.addonName}`)
                && fs.existsSync(`${state.config.paths.output}/${target.jsName}`);
            createLib(target, 'Bridge', opt);
            const built = await buildNode(target, { force: !distComplete });
            publishNodeData(target, { refresh: built });
            if (!built) {
                continue;
            }
            publishNodeAddon(target);
        }
    }
    const loaderTarget = targets.find((target) => target.buildType === 'release') ?? targets[0];
    if (headers.length && fs.existsSync(`${state.config.paths.output}/${loaderTarget.jsName}`)) {
        const entry = `${state.config.paths.output}/node/napi.mjs`;
        writeRuntimeEntry(entry, headers, ENTRY_RUNTIMES.node(loaderTarget.jsName));
        if (imports.size) writeImportHooks(entry, headers, imports, nativeExtensions(state.config.ext));
        else removeImportHooks(entry);
    }
}

// The Node and edge wasm builds are CommonJS with a .js extension, which a "type": "module" package loads as
// ESM. A package.json of the output's own scopes them back, unless the output is a package root.
const OUTPUT_SCOPE = '{\n    "type": "commonjs"\n}\n';
function scopeOutputToCommonJs() {
    const file = `${state.config.paths.output}/package.json`;
    if (!fs.existsSync(file)) {
        fs.mkdirSync(state.config.paths.output, { recursive: true });
        fs.writeFileSync(file, OUTPUT_SCOPE);
    }
}

async function createWasmJs(targetParams, wasmOptions = {}) {
    const targets = getFilteredBuildTargets(targetParams, { platform: 'wasm' });
    if (targets.length === 0) {
        return;
    }
    const headers = createBridges();
    const bindsImports = (target) => bindsAppImports(target, wasmOptions);
    const imports = targets.some(bindsImports) ? findAppNativeImports([state.targets.find((t) => t.platform === 'wasm')]) : new Map();
    const appHeaders = [...headers, ...createImportedBridges(headers, imports)];
    const optOf = (bridged) => ({
        buildSource: false,
        nativeGlob: [
            `${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`,
            ...bridged.flatMap((header) => header.bridge ?? []),
        ],
    });

    for (const target of targets) {
        // An artifact merely existing in dist used to short-circuit this whole
        // step, which kept serving stale output after flag/runtime changes.
        // Let the link fingerprint inside buildWasm decide instead; force the
        // relink when dist is incomplete, because a fingerprint hit skips the
        // link and the copy step below moved build/data away on the last run.
        const distComplete = fs.existsSync(`${state.config.paths.output}/${target.jsName}`)
            && fs.existsSync(`${state.config.paths.output}/${target.wasmName}`);
        createLib(target, 'Bridge', optOf(bindsImports(target) ? appHeaders : headers));
        const built = await buildWasm(target, { force: !distComplete });
        if (!built) {
            continue;
        }

        fs.rmSync(`${state.config.paths.output}/data`, { recursive: true, force: true });
        if (fs.existsSync(`${state.config.paths.build}/data`)) {
            fs.renameSync(`${state.config.paths.build}/data`, `${state.config.paths.output}/data`);
        }

        fs.copyFileSync(`${state.config.paths.build}/${target.jsName}`, `${state.config.paths.output}/${target.jsName}`);
        fs.copyFileSync(`${state.config.paths.build}/${target.wasmName}`, `${state.config.paths.output}/${target.wasmName}`);
        if (fs.existsSync(`${state.config.paths.build}/${target.dataTxtName}`)) {
            fs.copyFileSync(`${state.config.paths.build}/${target.dataTxtName}`, `${state.config.paths.output}/${target.dataTxtName}`);
        }
    }

    if (targets.some((target) => ['node', 'edge'].includes(target.runtimeEnv))) {
        scopeOutputToCommonJs();
    }
    // The list a page that maps the app's imports itself reads; a build without --bind-imports is not for one.
    if (targets.some((target) => target.runtimeEnv === 'browser')) {
        const manifest = `${state.config.paths.output}/browser/imports.json`;
        if (wasmOptions.bindImports) writeImportManifest(manifest, appHeaders, imports, state.config.paths.project);
        else fs.rmSync(manifest, { force: true });
    }
    // A runtime's entry loads its single-thread wasm32 release build.
    const entryTargetOf = (runtimeEnv) => targets.find((target) => target.runtimeEnv === runtimeEnv && target.arch === 'wasm32'
        && target.runtime === 'st' && target.buildType === 'release' && fs.existsSync(`${state.config.paths.output}/${target.jsName}`));
    const nodeTarget = entryTargetOf('node');
    const edgeTarget = entryTargetOf('edge');
    if (appHeaders.length && nodeTarget) {
        const entry = `${state.config.paths.output}/node/wasm.mjs`;
        writeRuntimeEntry(entry, appHeaders, ENTRY_RUNTIMES.node(nodeTarget.jsName));
        if (imports.size) writeImportHooks(entry, appHeaders, imports, nativeExtensions(state.config.ext));
        else removeImportHooks(entry);
    }
    if (headers.length && edgeTarget) {
        writeRuntimeEntry(`${state.config.paths.output}/edge/wasm.mjs`, headers, ENTRY_RUNTIMES.edge(edgeTarget.jsName, edgeTarget.wasmName));
    }
}

function createListParser(validList, resolve = (items) => items) {
    return (value, previous) => {
        const items = resolve(value.split(',').map(item => item.trim()));
        for (const item of items) {
            if (!validList.includes(item)) {
                throw new Error(`Invalid value: "${item}". Allowed values: ${validList.join(', ')}`);
            }
        }
        return previous ? previous.concat(items) : items;
    };
}