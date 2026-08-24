#!/usr/bin/env node

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Command, Option } from 'commander';

import { state } from './index.js';
import createBridgeFile from './actions/createInterface.js';
import createLib from './actions/createLib.js';
import buildWasm from './actions/buildWasm.js';
import buildWasiCommand from './actions/buildWasiCommand.js';
import buildExternal from './actions/buildExternal.js';
import buildPackageTypes from './actions/buildTypes.js';
import buildLib from './actions/buildLib.js';
import buildDependencies from './actions/buildDependencies.js';
import runCrossbindApp from './actions/run.js';
import { getFilteredBuildTargets } from './actions/target.js';

import writeJson from './utils/writeJson.js';
import flattenConfigForTable from './utils/flattenConfigForTable.js';
import systemKeys from './utils/systemKeys.js';
import logger from './utils/logger.js';
import { getDockerImage, getDockerContainerName } from './utils/pullDockerImage.js';
import { cargoHome } from './utils/runCargo.js';
import { cleanDepsCache } from './utils/dependencyRebuild.js';
import collectLicenseRows from './actions/licenses.js';
import { formatNoticesMarkdown, formatCycloneDxSbom, validateSpdx } from './utils/licenseReport.js';
import findFiles from './utils/findFiles.js';

const packageJSON = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));

const platforms = [...new Set(state.targets.map(target => target.platform).filter(t => t))];
const archs = [...new Set(state.targets.map(target => target.arch).filter(t => t))];
const runtimes = [...new Set(state.targets.map(target => target.runtime).filter(t => t))];
const buildTypes = [...new Set(state.targets.map(target => target.buildType).filter(t => t))];
const runtimeEnvs = [...new Set(state.targets.map(target => target.runtimeEnv).filter(t => t))];

// Build failures bubble up as exceptions with a `cause` chain (see actions/run.js);
// show the operator a single line — DEBUG=1 for the full stack — and exit non-zero.
const handleFatal = (e) => {
    if (process.env.DEBUG) {
        console.error(e);
    } else {
        let message = e?.message || String(e);
        if (e?.cause?.message) message += `\n  caused by: ${e.cause.message.split('\n')[0]}`;
        console.error(message);
    }
    process.exit(1);
};
process.on('uncaughtException', handleFatal);
process.on('unhandledRejection', handleFatal);

const program = new Command();

program
    .name('crossbind')
    .description('Compile C++ files to WebAssembly and native platforms.')
    .version(packageJSON.version)
    .showHelpAfterError();

program.command('build')
    .description('compile the project that was set up using crossbind')
    .addOption(new Option('-p, --platform <platform>', 'target platform').argParser(createListParser(platforms)))
    .addOption(new Option('-a, --arch <arch>', 'target architecture').argParser(createListParser(archs)))
    .addOption(new Option('-r, --runtime <runtime>', 'target runtime').argParser(createListParser(runtimes)))
    .addOption(new Option('-b, --build-type <buildType>', 'target build type').argParser(createListParser(buildTypes)))
    .addOption(new Option('-e, --runtime-env <runtimeEnv>', 'target runtime environment').argParser(createListParser(runtimeEnvs)))
    .option('--rebuild-deps [list]', 'rebuild dependencies from source instead of using prebuilt (all, or a comma-separated list of names)')
    .action((options) => {
        const { rebuildDeps, ...rest } = options;
        const targetParams = { ...rest };

        if (!targetParams.arch) {
            targetParams.arch = archs.filter(item => item !== 'wasm64');
        }
        if (!targetParams.buildType) {
            targetParams.buildType = ['release'];
        }

        targetParams.platform = targetParams.platform || platforms;
        targetParams.arch = targetParams.arch || archs;
        targetParams.runtime = targetParams.runtime || runtimes;
        targetParams.buildType = targetParams.buildType || buildTypes;
        targetParams.runtimeEnv = targetParams.runtimeEnv || runtimeEnvs;

        if (state.config.build.withBuildConfig) {
            buildExternal(targetParams);
        } else {
            build(targetParams, rebuildDeps);
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

program.command('licenses')
    .description('list bundled native dependencies with SPDX license, versions and source URL')
    .option('--notices [file]', 'write a THIRD-PARTY-NOTICES markdown file (default: THIRD-PARTY-NOTICES.md)')
    .option('--sbom [file]', 'write a CycloneDX SBOM json file (default: sbom.cdx.json)')
    .option('--check', 'exit non-zero when a license field is missing or not valid SPDX')
    .option('--platform <platform>', "also list what this platform's artifact statically links beyond the package graph (vendored copies, toolchain runtime)")
    .action(async (options) => {
        const rows = await collectLicenseRows(options.platform || null);
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
const IMAGE_ROLES = ['web', 'android'];
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
        // Google ships the linux NDK for x86_64 only, so an android container is always amd64.
        const platform = image === 'android' ? 'linux/amd64' : undefined;
        dockerExec([
            'run', '-dit',
            ...(platform ? ['--platform', platform] : []),
            '--name', dockerContainerName(image),
            '-v', `${state.config.paths.base}:/tmp/crossbind/live`,
            // Cargo's registry cache, shared with host builds and with every other project.
            '-v', `${cargoHome()}:/var/cache/crossbind/cargo`,
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

const commandConfig = program.command('config')
    .description('manage the crossbind configuration files');

commandConfig.command('get')
    .description('get the crossbind system configuration')
    .argument('<key>', 'configuration key to read')
    .action((key) => getSystemConfig(key));

commandConfig.command('set')
    .description('set the crossbind system configuration')
    .argument('<key>', 'configuration key to set')
    .argument('<value>', 'value to assign')
    .action((key, value) => setSystemConfig(key, value));

commandConfig.command('delete')
    .description('delete the crossbind system configuration')
    .argument('<key>', 'configuration key to remove')
    .action((key) => deleteSystemConfig(key));

commandConfig.command('list')
    .description('list the crossbind configurations')
    .addOption(new Option('-t, --type <type>', 'config type').default('system').choices(['all', 'system', 'project']))
    .action((options) => listSystemConfig(options.type));

commandConfig.command('keys')
    .description('list all available system configuration keys for crossbind')
    .action(() => listSystemKeys());

// `pnpm run <script> -- --flag` forwards the `--` literally and commander would then
// treat the flags as positionals. Strip the first separator for commands where every
// argument is an option; `run`/`docker run` keep it for program arguments.
const argv = [...process.argv];
if (['build', 'clean-deps', 'licenses'].includes(argv[2])) {
    const separatorIndex = argv.indexOf('--');
    if (separatorIndex !== -1) argv.splice(separatorIndex, 1);
}

program.parse(argv);

function listSystemKeys() {
    console.info('Available configurations:');
    console.table(systemKeys);
}

function getSystemConfig(systemKey) {
    if (!systemKey) {
        listSystemConfig('system');
        return;
    }
    const key = systemKey.toUpperCase();
    const output = {};
    if (key in state.config.system) {
        output[key] = { value: state.config.system[key] || 'undefined', default: systemKeys[key].default };
    }
    Object.keys(systemKeys).filter((k) => k.includes(key)).forEach((k) => {
        if (k in state.config.system) {
            output[k] = { value: state.config.system[k] || 'undefined', default: systemKeys[k].default };
        }
    });

    console.table(output);
}

function setSystemConfig(key, value) {
    if (!systemKeys[key]) {
        throw new Error(`Configuration ${key} is not available. Please choose from the following available configurations: ${Object.keys(systemKeys).join(', ')}`);
    }
    if (systemKeys[key].options && !systemKeys[key].options.includes(value)) {
        throw new Error(`Value ${value} is not available. Please choose from the following available values: ${systemKeys[key].options.join(', ')}`);
    }

    state.config.system[key] = value;
    writeJson(state.config.paths.systemConfig, state.config.system);
}

function deleteSystemConfig(key) {
    if (!systemKeys[key]) {
        throw new Error(`Configuration ${key} is not available. Please choose from the following available configurations: ${Object.keys(systemKeys).join(', ')}`);
    }
    delete state.config.system[key];
    writeJson(state.config.paths.systemConfig, state.config.system);
}

function listSystemConfig(type) {
    const { system: systemConfig, ...projectConfig } = state.config;
    if (type === 'all' || type === 'system') {
        console.log('System Configuration');
        console.table(systemConfig);
    }

    if (type === 'all') {
        console.log('');
    }

    if (type === 'all' || type === 'project') {
        console.log(`Project Configuration (paths relative to ${projectConfig.paths.base})`);
        console.table(flattenConfigForTable(projectConfig, { base: projectConfig.paths.base }));
    }
}

function run(programName, params) {
    runCrossbindApp(programName, params, null, null, { console: true });
}

async function build(targetParams, rebuildOption) {
    await buildDependencies({ targetParams, rebuildOption });
    buildLib(targetParams);
    createWasmJs(targetParams);
    await createWasiCommands(targetParams);
    buildPackageTypes();
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
        fs.copyFileSync(`${state.config.paths.build}/${target.wasmName}`, distWasm);
        // Copied (not renamed) so a later fingerprint cache-hit still has the
        // build-dir tree to serve from.
        if (fs.existsSync(`${state.config.paths.build}/data`)) {
            fs.rmSync(`${state.config.paths.output}/data`, { recursive: true, force: true });
            fs.cpSync(`${state.config.paths.build}/data`, `${state.config.paths.output}/data`, { recursive: true });
        }
    }
}

async function createWasmJs(targetParams) {
    if (state.config.export.bundle === false) {
        return;
    }
    const targets = getFilteredBuildTargets(targetParams, { platform: 'wasm' });
    if (targets.length === 0) {
        return;
    }
    let headers = [];
    state.config.paths.header.forEach((headerPath) => {
        headers.push(findFiles('**/*.h', { cwd: headerPath }));
    });
    headers = headers.filter((path) => !!path.toString()).flat();

    const bridges = [];
    headers.forEach((header) => {
        const bridgePath = createBridgeFile(header);
        bridges.push(bridgePath);
    });

    const opt = {
        buildSource: false,
        nativeGlob: [
            `${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`,
            ...bridges,
        ],
    };

    for (const target of targets) {
        // An artifact merely existing in dist used to short-circuit this whole
        // step, which kept serving stale output after flag/runtime changes.
        // Let the link fingerprint inside buildWasm decide instead; force the
        // relink when dist is incomplete, because a fingerprint hit skips the
        // link and the copy step below moved build/data away on the last run.
        const distComplete = fs.existsSync(`${state.config.paths.output}/${target.jsName}`)
            && fs.existsSync(`${state.config.paths.output}/${target.wasmName}`);
        createLib(target, 'Bridge', opt);
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
}

function createListParser(validList) {
    return (value, previous) => {
        const items = value.split(',').map(item => item.trim());
        for (const item of items) {
            if (!validList.includes(item)) {
                throw new Error(`Invalid value: "${item}". Allowed values: ${validList.join(', ')}`);
            }
        }
        return previous ? previous.concat(items) : items;
    };
}