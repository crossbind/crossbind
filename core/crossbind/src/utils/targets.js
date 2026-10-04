// Single source for the build-target matrix and its naming; state/ copies (and then
// decorates) these entries, and consumer runtimes read them without touching CLI state.

const BASE_TARGETS = [
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', runtimeEnv: 'browser',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', runtimeEnv: 'edge',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'debug', runtimeEnv: 'browser',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'debug', runtimeEnv: 'edge',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'mt', buildType: 'release', runtimeEnv: 'browser',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'mt', buildType: 'debug', runtimeEnv: 'browser',
    },
    {
        platform: 'wasm', arch: 'wasm32', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'st', buildType: 'release', runtimeEnv: 'browser',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'st', buildType: 'release', runtimeEnv: 'edge',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'st', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'st', buildType: 'debug', runtimeEnv: 'browser',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'st', buildType: 'debug', runtimeEnv: 'edge',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'st', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'mt', buildType: 'release', runtimeEnv: 'browser',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'browser',
    },
    {
        platform: 'wasm', arch: 'wasm64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'wasi', arch: 'wasm32', runtime: 'st', buildType: 'release', runtimeEnv: 'wasi',
    },
    {
        platform: 'wasi', arch: 'wasm32', runtime: 'st', buildType: 'debug', runtimeEnv: 'wasi',
    },
    {
        platform: 'android', arch: 'arm64-v8a', runtime: 'mt', buildType: 'release',
    },
    {
        platform: 'android', arch: 'arm64-v8a', runtime: 'mt', buildType: 'debug',
    },
    {
        platform: 'android', arch: 'x86_64', runtime: 'mt', buildType: 'release',
    },
    {
        platform: 'android', arch: 'x86_64', runtime: 'mt', buildType: 'debug',
    },
    {
        platform: 'ios', arch: 'iphoneos', runtime: 'mt', buildType: 'release',
    },
    {
        platform: 'ios', arch: 'iphoneos', runtime: 'mt', buildType: 'debug',
    },
    {
        platform: 'ios', arch: 'iphonesimulator', runtime: 'mt', buildType: 'release',
    },
    {
        platform: 'ios', arch: 'iphonesimulator', runtime: 'mt', buildType: 'debug',
    },
    {
        platform: 'darwin', arch: 'arm64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'darwin', arch: 'arm64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'darwin', arch: 'x64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'darwin', arch: 'x64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'linux', arch: 'arm64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'linux', arch: 'arm64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'linux', arch: 'x64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'linux', arch: 'x64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'linuxmusl', arch: 'arm64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'linuxmusl', arch: 'arm64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'linuxmusl', arch: 'x64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'linuxmusl', arch: 'x64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'win32', arch: 'arm64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'win32', arch: 'arm64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
    {
        platform: 'win32', arch: 'x64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
    },
    {
        platform: 'win32', arch: 'x64', runtime: 'mt', buildType: 'debug', runtimeEnv: 'node',
    },
];

// A native executable links the same archives as the Node-API addon of its platform and arch.
export const TARGETS = [
    ...BASE_TARGETS,
    ...BASE_TARGETS
        .filter((target) => target.runtimeEnv === 'node' && target.platform !== 'wasm')
        .map((target) => ({ ...target, runtimeEnv: 'native' })),
];

// Built only when named with -p: a plain `crossbind build` keeps producing what it did before
// native Node.js addons existed.
export const OPT_IN_PLATFORMS = ['darwin', 'linux', 'linuxmusl', 'win32'];

// Built on the host itself: Apple's linker and SDKs exist in no toolchain image.
export const HOST_BUILT_PLATFORMS = ['ios', 'darwin'];

// The runtime environment names the binary a build makes; android and ios have none, since
// React Native links them.
export const runtimeEnvsOf = (platform) => [
    ...new Set(TARGETS.filter((target) => target.platform === platform && target.runtimeEnv).map((target) => target.runtimeEnv)),
];

export const RUNTIME_ENVS = [...new Set(TARGETS.map((target) => target.runtimeEnv).filter(Boolean))];

// A build makes only the binaries it is asked for: -e first, then the config's target.runtimeEnv.
// Bundler plugins ask through getTargetParams instead.
export function selectRuntimeEnvs(cliRuntimeEnvs, configRuntimeEnv) {
    if (cliRuntimeEnvs?.length) return cliRuntimeEnvs;
    return configRuntimeEnv ? [configRuntimeEnv] : [];
}

export function targetPathOf(target) {
    return `${target.platform}-${target.arch}-${target.runtime}-${target.buildType}`;
}

// The release build of a target, whose prebuilts a debug build of it falls back to.
export const releaseTargetOf = (target) => ({ ...target, buildType: 'release', path: target.releasePath });

// Every platform/arch addon of one build type sits next to a single loader, which fills in
// {platform} and {arch} from the running process. The loader is CommonJS whatever the package
// "type" says, since it needs __dirname and process.dlopen.
export function nodeAddonNamesOf(target, projectName) {
    const suffix = target.buildType === 'debug' ? '.debug' : '';
    const addonPattern = `${projectName}.{platform}-{arch}${suffix}.node`;
    return {
        addonPattern,
        addonName: addonPattern.replace('{platform}', target.platform).replace('{arch}', target.arch),
        jsName: `${projectName}.native${suffix}.cjs`,
    };
}

// One executable per platform, arch and build type, named like the addons it replaces.
export function nativeCommandNamesOf(target, projectName) {
    const suffix = target.buildType === 'debug' ? '.debug' : '';
    const extension = target.platform === 'win32' ? '.exe' : '';
    return { commandName: `${projectName}.${target.platform}-${target.arch}${suffix}${extension}` };
}

export function filterTargetSpecs(targetSpecs, target) {
    return targetSpecs?.filter(t => (
        (!t.platform || t.platform === target.platform)
        && (!t.arch || t.arch === target.arch)
        && (!t.runtime || t.runtime === target.runtime)
        && (!t.buildType || t.buildType === target.buildType)
        && (!t.runtimeEnv || t.runtimeEnv === target.runtimeEnv)
    ))?.map(t => t?.specs)?.filter(t => t) || [];
}
