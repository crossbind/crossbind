import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import pullDockerImage, { getDockerImage, getDockerContainerName, imageRoleFor } from '../utils/pullDockerImage.js';
import getOsUserAndGroupId from '../utils/getOsUserAndGroupId.js';
import replaceBasePathForDockerUtil from '../utils/replaceBasePathForDocker.js';
import { DOCKER_RUN_SECURITY_ARGS } from '../utils/dockerSecurity.js';
import state from '../state/index.js';
import { wasiCFlags, wasiCxxFlags, resolveWasiSdkPath, WASI_TARGET_TRIPLE } from '../utils/wasiToolchain.js';
import { HOST_BUILT_PLATFORMS } from '../utils/targets.js';
import { WASM_EXCEPTION_FLAGS } from '../utils/archiveFlags.js';
import { ANDROID_NDK, ANDROID_API_LEVEL } from '../utils/androidToolchain.js';
import { IOS_DEVELOPER_DIR, IOS_DEPLOYMENT_TARGET, XCODE_TOOLCHAIN_BIN } from '../utils/iosToolchain.js';
import { LINUX_ARCHIVE_FLAGS, linuxBuildEnv, linuxToolchainFile } from '../utils/linuxToolchain.js';
import { windowsBuildEnv, windowsToolchainFile } from '../utils/windowsToolchain.js';
import {
    DARWIN_CC, DARWIN_CXX, DARWIN_DEPLOYMENT_TARGET, DARWIN_HOST_PACKAGE_PREFIXES, DARWIN_TOOLS_BIN,
} from '../utils/darwinToolchain.js';

// Native builds can outrun Node's 1 MiB default pipe buffer; without a raised cap a successful build dies with ENOBUFS.
const EXEC_MAX_BUFFER = 512 * 1024 * 1024;
const envParams = (env) => Object.entries(env).flatMap(([variable, value]) => ['-e', `${variable}=${value}`]);
const CROSSCOMPILER_ARM64 = `aarch64-linux-android${ANDROID_API_LEVEL}`;
const CROSSCOMPILER_x86_64 = `x86_64-linux-android${ANDROID_API_LEVEL}`;
const t = `${ANDROID_NDK}/toolchains/llvm/prebuilt/linux-x86_64/bin`;
const t2 = `${ANDROID_NDK}/toolchains/llvm/prebuilt/linux-x86_64`;

const iosBinPath = XCODE_TOOLCHAIN_BIN;
const iosSdkPath = `${IOS_DEVELOPER_DIR}/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk`;
const iosSimSdkPath = `${IOS_DEVELOPER_DIR}/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator.sdk`;

const androidParamsArm64 = [
    '-e',
    `AR=${t}/llvm-ar`,
    '-e',
    `AS=${t}/llvm-as`,
    '-e',
    `CC=${t}/${CROSSCOMPILER_ARM64}-clang`,
    '-e',
    `CXX=${t}/${CROSSCOMPILER_ARM64}-clang++`,
    '-e',
    `LD=${t}/ld`,
    '-e',
    `RANLIB=${t}/llvm-ranlib`,
    '-e',
    `STRIP=${t}/llvm-strip`,
    '-e',
    `NM=${t}/nm`,
    '-e',
    `CFLAGS=--sysroot=${t2}/sysroot`,
];

const androidParamsX86_64 = [
    '-e',
    `AR=${t}/llvm-ar`,
    '-e',
    `AS=${t}/llvm-as`,
    '-e',
    `CC=${t}/${CROSSCOMPILER_x86_64}-clang`,
    '-e',
    `CXX=${t}/${CROSSCOMPILER_x86_64}-clang++`,
    '-e',
    `LD=${t}/ld`,
    '-e',
    `RANLIB=${t}/llvm-ranlib`,
    '-e',
    `STRIP=${t}/llvm-strip`,
    '-e',
    `NM=${t}/nm`,
    '-e',
    `CFLAGS=--sysroot=${t2}/sysroot`,
];

const DARWIN_HOST_ARCH = process.arch === 'x64' ? 'x86_64' : 'arm64';
// Apple's own tools only, which find the SDK through xcrun. A GNU ar earlier on the PATH (Homebrew's
// binutils) writes archives that Apple's linker rejects.
const DARWIN_BUILD_PATH = [DARWIN_TOOLS_BIN, '/bin', '/usr/sbin', '/sbin'].join(':');
const IOS_HOST_FLAGS = `-arch arm64 -isysroot ${iosSdkPath} -fembed-bitcode`;
const IOS_SIM_HOST_FLAGS = `-arch arm64 -isysroot ${iosSimSdkPath} -fembed-bitcode`;
const IOS_IPHONE_PARAMS = ['-e', `CFLAGS="${IOS_HOST_FLAGS}"`, '-e', `CXXFLAGS="${IOS_HOST_FLAGS}"`, '-e', `LDFLAGS="${IOS_HOST_FLAGS}"`];
const IOS_SIM_PARAMS = ['-e', `CFLAGS="${IOS_SIM_HOST_FLAGS}"`, '-e', `CXXFLAGS="${IOS_SIM_HOST_FLAGS}"`, '-e', `LDFLAGS="${IOS_SIM_HOST_FLAGS}"`];
const iosParams = [
    '-e',
    `AR=${iosBinPath}/ar`,
    '-e',
    `AS=${iosBinPath}/as`,
    '-e',
    `CC=${iosBinPath}/clang`,
    '-e',
    `CXX=${iosBinPath}/clang++`,
    '-e',
    `CPP=${iosBinPath}/cpp`,
    '-e',
    `LD=${iosBinPath}/ld`,
    '-e',
    `RANLIB=${iosBinPath}/ranlib`,
    '-e',
    `STRIP=${iosBinPath}/strip`,
    '-e',
    `NM=${iosBinPath}/llvm-nm`,
];

/* const iosMetalParams = [
    '-e', `AR=${iosBinPath}/metal-ar`,
    '-e', `AS=${iosBinPath}/metal-as`,
    '-e', `CC=${iosBinPath}/clang`,
    '-e', `CXX=${iosBinPath}/clang++`,
    '-e', `CPP=${iosBinPath}/cpp`,
    '-e', `LD=${iosBinPath}/ld`,
    '-e', `RANLIB=${iosBinPath}/metal-ranlib`,
    '-e', `STRIP=${iosBinPath}/metal-strip`,
    '-e', `NM=${iosBinPath}/metal-nm`,
    '-e', `CFLAGS="${IOS_HOST_FLAGS}"`,
    '-e', `CXXFLAGS="${IOS_HOST_FLAGS}"`,
    '-e', `LDFLAGS="${IOS_HOST_FLAGS}"`,
]; */

// The C++ compiler of the image that runs SWIG for the target, so its -dM macro table matches that parse.
export function cxxPreprocessorFor(target) {
    if (imageRoleFor(target) !== 'android') return 'em++';
    return `${t}/${target.arch === 'x86_64' ? CROSSCOMPILER_x86_64 : CROSSCOMPILER_ARM64}-clang++`;
}

export default function run(program, params = [], platformPrefix = null, target = null, dockerOptions = {}) {
    const buildPath = platformPrefix ? `${state.config.paths.build}/${platformPrefix}/${target.path}` : state.config.paths.build;
    if (!fs.existsSync(buildPath)) {
        fs.mkdirSync(buildPath, { recursive: true });
    }

    // wasi is host-run only with a locally configured wasi-sdk; otherwise docker carries it.
    const wasiHostSdk = target?.platform === 'wasi' ? resolveWasiSdkPath(state.config.system) : null;
    if ((!HOST_BUILT_PLATFORMS.includes(target?.platform) && !(target?.platform === 'wasi' && wasiHostSdk)) || program !== null) {
        // Google ships the linux NDK for x86_64 only, so the android index carries no arm64 leaf;
        // pull its amd64 leaf by ref or an arm64 host finds no matching manifest.
        pullDockerImage(imageRoleFor(target), target?.platform === 'android' ? 'linux/amd64' : undefined);
    }

    let dProgram = program;
    let dParams = params;
    let platformParams = [];
    if (program === null) {
        switch (target.platform) {
            case 'wasm':
                platformParams = ['-e', `CXXFLAGS=${WASM_EXCEPTION_FLAGS.join(' ')}`, '-e', `CFLAGS=${WASM_EXCEPTION_FLAGS.join(' ')}`];
                if (params[0].toLowerCase().includes('configure')) dProgram = 'emconfigure';
                else if (params[0] === 'make') dProgram = 'emmake';
                else if (params[0] === 'cmake') dProgram = 'emcmake';
                else if (params[0] === 'cc') dProgram = 'emcc';
                break;
            case 'wasi': {
                const wasiSdk = wasiHostSdk || '/opt/wasi-sdk';
                if (wasiHostSdk && !fs.existsSync(`${wasiHostSdk}/share/wasi-sysroot/lib/${WASI_TARGET_TRIPLE}`)) {
                    throw new Error(
                        `crossbind: the wasi-sdk at ${wasiHostSdk} has no ${WASI_TARGET_TRIPLE} sysroot. platform:'wasi' targets WASI 0.3 (p3) - upgrade to wasi-sdk >= 34.`,
                    );
                }
                [dProgram, ...dParams] = params;
                platformParams = [
                    '-e',
                    `CC=${wasiSdk}/bin/clang`,
                    '-e',
                    `CXX=${wasiSdk}/bin/clang++`,
                    '-e',
                    `AR=${wasiSdk}/bin/ar`,
                    '-e',
                    `RANLIB=${wasiSdk}/bin/ranlib`,
                    '-e',
                    `NM=${wasiSdk}/bin/nm`,
                    '-e',
                    `CFLAGS=${wasiCFlags().join(' ')}`,
                    '-e',
                    `CXXFLAGS=${wasiCxxFlags().join(' ')}`,
                ];
                if (dProgram === 'cmake' && dParams[0] !== '--build' && dParams[0] !== '--install') {
                    dParams = [...dParams, `-DCMAKE_TOOLCHAIN_FILE=${wasiSdk}/share/cmake/wasi-sdk-p3.cmake`];
                } else if (dProgram === 'wasi-clang++') {
                    dProgram = `${wasiSdk}/bin/clang++`;
                    platformParams = [];
                } else if (dProgram === 'wasi-clang') {
                    dProgram = `${wasiSdk}/bin/clang`;
                    platformParams = [];
                }
                break;
            }
            case 'android':
                [dProgram, ...dParams] = params;
                platformParams = target.arch === 'x86_64' ? androidParamsX86_64 : androidParamsArm64;
                if (dProgram === 'cmake') {
                    dParams = [
                        ...dParams,
                        `-DCMAKE_TOOLCHAIN_FILE=${ANDROID_NDK}/build/cmake/android.toolchain.cmake`,
                        `-DANDROID_ABI=${target.arch === 'x86_64' ? 'x86_64' : 'arm64-v8a'}`,
                        `-DANDROID_PLATFORM=android-${ANDROID_API_LEVEL}`,
                        `-DANDROID_NDK=${ANDROID_NDK}`,
                    ];
                }
                break;
            case 'ios':
                [dProgram, ...dParams] = params;
                platformParams = [...iosParams, ...(target.arch === 'iphoneos' ? IOS_IPHONE_PARAMS : IOS_SIM_PARAMS)];
                if (dProgram === 'cmake') {
                    platformParams = [];
                    if (dParams[0] !== '--build' && dParams[0] !== '--install') {
                        dParams = [
                            ...dParams,
                            '-G',
                            'Xcode',
                            '-DBUILD_SHARED_LIBS=OFF',
                            '-DFRAMEWORK=TRUE',
                            `-DCMAKE_OSX_DEPLOYMENT_TARGET=${IOS_DEPLOYMENT_TARGET}`,
                            '-DCMAKE_SYSTEM_NAME=iOS',
                            `-DMACOSX_FRAMEWORK_IDENTIFIER=dev.crossbind.${state.config.general.name}`,
                            `-DCMAKE_XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER=dev.crossbind.${state.config.general.name}`,
                            `-DCMAKE_OSX_SYSROOT='${target.arch === 'iphoneos' ? iosSdkPath : iosSimSdkPath}'`,
                            '-DCMAKE_OSX_ARCHITECTURES=arm64',
                            '-DCMAKE_SYSTEM_PROCESSOR=arm64',
                            `-DCMAKE_C_FLAGS=${target.arch === 'iphoneos' ? '-fembed-bitcode' : '-fembed-bitcode-marker'}`,
                            `-DCMAKE_CXX_FLAGS=${target.arch === 'iphoneos' ? '-fembed-bitcode' : '-fembed-bitcode-marker'}`,
                            "-DCMAKE_XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY='iPhone Developer'",
                            `-DCMAKE_XCODE_ATTRIBUTE_DEVELOPMENT_TEAM=${state.config.system.XCODE_DEVELOPMENT_TEAM}`,
                        ];
                    }
                } else if (dProgram === 'ios-cmake') {
                    dProgram = 'cmake';
                    platformParams = [];
                    if (dParams[0] !== '--build' && dParams[0] !== '--install') {
                        dParams = [
                            ...dParams,
                            `-DCMAKE_TOOLCHAIN_FILE='${state.config.paths.cli}/assets/cmake/ios.toolchain.cmake'`,
                            `-DPLATFORM=${target.arch === 'iphoneos' ? 'OS64' : 'SIMULATORARM64'}`,
                            `-DDEPLOYMENT_TARGET=${IOS_DEPLOYMENT_TARGET}`,
                            '-DARCHS=arm64',
                            '-DENABLE_BITCODE=TRUE',
                            '-DBUILD_SHARED_LIBS=OFF',
                            '-DFRAMEWORK=TRUE',
                            `-DCMAKE_OSX_DEPLOYMENT_TARGET=${IOS_DEPLOYMENT_TARGET}`,
                            '-DCMAKE_SYSTEM_NAME=iOS',
                            `-DMACOSX_FRAMEWORK_IDENTIFIER=dev.crossbind.${state.config.general.name}`,
                            `-DCMAKE_XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER=dev.crossbind.${state.config.general.name}`,
                            `-DCMAKE_OSX_SYSROOT='${target.arch === 'iphoneos' ? iosSdkPath : iosSimSdkPath}'`,
                            '-DCMAKE_OSX_ARCHITECTURES=arm64',
                            '-DCMAKE_SYSTEM_PROCESSOR=arm64',
                            `-DCMAKE_C_FLAGS=${target.arch === 'iphoneos' ? '-fembed-bitcode' : '-fembed-bitcode-marker'}`,
                            `-DCMAKE_CXX_FLAGS=${target.arch === 'iphoneos' ? '-fembed-bitcode' : '-fembed-bitcode-marker'}`,
                            "-DCMAKE_XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY='iPhone Developer'",
                            `-DCMAKE_XCODE_ATTRIBUTE_DEVELOPMENT_TEAM=${state.config.system.XCODE_DEVELOPMENT_TEAM}`,
                        ];
                    }
                }
                break;
            case 'linux':
            case 'linuxmusl': {
                [dProgram, ...dParams] = params;
                const archiveFlags = LINUX_ARCHIVE_FLAGS.join(' ');
                platformParams = [
                    ...envParams(linuxBuildEnv(target)),
                    '-e', `CFLAGS=${archiveFlags}`, '-e', `CXXFLAGS=${archiveFlags}`,
                ];
                if (dProgram === 'cmake' && dParams[0] !== '--build' && dParams[0] !== '--install') {
                    dParams = [...dParams, `-DCMAKE_TOOLCHAIN_FILE=${linuxToolchainFile(target)}`];
                }
                break;
            }
            case 'win32': {
                [dProgram, ...dParams] = params;
                platformParams = envParams(windowsBuildEnv(target));
                if (dProgram === 'cmake' && dParams[0] !== '--build' && dParams[0] !== '--install') {
                    dParams = [...dParams, `-DCMAKE_TOOLCHAIN_FILE=${windowsToolchainFile(target)}`];
                }
                break;
            }
            case 'darwin': {
                [dProgram, ...dParams] = params;
                const appleArch = target.arch === 'x64' ? 'x86_64' : 'arm64';
                // None of the machine's own packages (DARWIN_HOST_PACKAGE_PREFIXES); the SDK's libraries stay visible.
                platformParams = ['-e', 'PKG_CONFIG_LIBDIR='];
                if (dProgram === 'cmake') {
                    if (dParams[0] !== '--build' && dParams[0] !== '--install') {
                        dParams = [
                            ...dParams,
                            `-DCMAKE_OSX_ARCHITECTURES=${appleArch}`,
                            `-DCMAKE_OSX_DEPLOYMENT_TARGET=${DARWIN_DEPLOYMENT_TARGET}`,
                            // Every archive ends up inside a loadable .node module.
                            '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
                            `-DCMAKE_IGNORE_PREFIX_PATH=${DARWIN_HOST_PACKAGE_PREFIXES.join(';')}`,
                            // The other architecture's probes cannot run here, so CMake has to know it cross-compiles.
                            ...(appleArch === DARWIN_HOST_ARCH ? [] : ['-DCMAKE_SYSTEM_NAME=Darwin', `-DCMAKE_SYSTEM_PROCESSOR=${appleArch}`]),
                        ];
                    }
                } else {
                    const flags = `-arch ${appleArch} -mmacosx-version-min=${DARWIN_DEPLOYMENT_TARGET}`;
                    // A --host triple sends configure after prefixed compilers (aarch64-apple-darwin-cc) that
                    // Xcode does not ship, and SQLite's autosetup has no fallback to the plain names.
                    platformParams.push(
                        '-e', `CC=${DARWIN_CC}`, '-e', `CXX=${DARWIN_CXX}`,
                        '-e', `CFLAGS=${flags}`, '-e', `CXXFLAGS=${flags}`, '-e', `LDFLAGS=${flags}`,
                    );
                }
                break;
            }
            default:
        }
    }

    const env = {};
    let runner = 'DOCKER';
    if (
        ((HOST_BUILT_PLATFORMS.includes(target?.platform) || (target?.platform === 'wasi' && wasiHostSdk)) && program === null) ||
        state.config.system.RUNNER === 'LOCAL'
    ) {
        runner = 'LOCAL';
    }

    if (runner === 'LOCAL') {
        const allowedEnv = [
            '^PWD$',
            '^SHELL$',
            '^LC_CTYPE$',
            '^PATH$',
            '^HOME$',
            '^TMPDIR$',
            '^USER$',
            '^PODS_*',
            '^CONFIGURATION_BUILD_DIR$',
            '^UNLOCALIZED_RESOURCES_FOLDER_PATH$',
        ];
        Object.entries(process.env).forEach(([key, value]) => {
            if (allowedEnv.some((e) => key.match(e))) {
                env[key] = value;
            }
        });
    }

    const pParams = [...platformParams, ...(dockerOptions.params || [])];
    for (let i = 0; i < pParams.length; i += 2) {
        if (pParams[i] === '-e') {
            const [key, ...rest] = pParams[i + 1].split('=');
            const value = rest.join('=');
            if (['CFLAGS', 'CXXFLAGS', 'CPPFLAGS', 'LDFLAGS'].includes(key)) {
                let v = value;
                if (v.startsWith("'") || v.startsWith('"')) {
                    v = v.substring(1, v.length - 1);
                }
                if (env[key]) env[key] += ` ${v}`;
                else env[key] = v;
            } else {
                env[key] = value;
            }
        }
    }

    let fileExecParams;
    if (runner === 'LOCAL') {
        env.PATH = `/opt/homebrew/bin:${env.PATH}`;
        // A package's *-config script on the PATH (nc-config, sfcgal-config, ...) would compile that
        // package into the archives. cmake is the one host tool a darwin build takes from the PATH.
        if (target?.platform === 'darwin') {
            if (dProgram === 'cmake') dProgram = findExecutable('cmake', env.PATH) ?? dProgram;
            env.PATH = DARWIN_BUILD_PATH;
        }

        const options = {
            cwd: dockerOptions.workdir || buildPath,
            stdio: dockerOptions.console ? 'inherit' : ['ignore', 'pipe', 'pipe'],
            env,
            maxBuffer: EXEC_MAX_BUFFER,
        };
        fileExecParams = [dProgram, dParams, options];
    } else if (runner === 'DOCKER') {
        const dockerEnv = [];
        Object.entries(env).forEach(([key, value]) => {
            dockerEnv.push('-e', `${key}=${value}`);
        });
        const options = { cwd: buildPath, stdio: dockerOptions.console ? 'inherit' : ['ignore', 'pipe', 'pipe'], maxBuffer: EXEC_MAX_BUFFER };

        let runnerParams;
        let imageOrContainer;
        const role = imageRoleFor(target);
        if (state.config.system.RUNNER === 'DOCKER_RUN') {
            imageOrContainer = getDockerImage(role);
            runnerParams = ['run', '--rm', ...DOCKER_RUN_SECURITY_ARGS, '-v', `${state.config.paths.base}:/tmp/crossbind/live`];
            if (target?.platform === 'android') {
                // Google ships the linux NDK for x86_64 only; use the amd64 leaf ref (classic store holds one platform per digest).
                pullDockerImage(role, 'linux/amd64');
                imageOrContainer = getDockerImage(role, 'linux/amd64');
                runnerParams.push('--platform', 'linux/amd64');
            }
        } else if (state.config.system.RUNNER === 'DOCKER_EXEC') {
            imageOrContainer = getDockerContainerName(state.config.paths.base, role);
            runnerParams = ['exec'];
        } else {
            throw new Error(`The runner ${state.config.system.RUNNER} is invalid.`);
        }

        const args = [
            ...runnerParams,
            '--user',
            getOsUserAndGroupId(),
            '--workdir',
            replaceBasePathForDocker(dockerOptions.workdir || buildPath),
            ...replaceBasePathForDocker(dockerEnv),
            // '-e', replaceBasePathForDocker(`CCACHE_DIR=${state.config.paths.build}/ccache`),
            imageOrContainer,
            replaceBasePathForDocker(dProgram),
            ...replaceBasePathForDocker(dParams),
        ];
        fileExecParams = ['docker', args, options];
    } else {
        throw new Error(`The runner ${state.config.system.RUNNER} or command is invalid.`);
    }

    try {
        execFileSync(...fileExecParams);
    } catch (e) {
        if (e?.stdout?.length) console.log(e.stdout.toString());
        if (e?.stderr?.length) console.error(e.stderr.toString());
        throw new Error(`crossbind: command failed${dProgram ? ` (${dProgram})` : ''} with exit code ${e?.status ?? 'unknown'}`, { cause: e });
    }
}

function findExecutable(name, searchPath) {
    return searchPath.split(':').map((dir) => `${dir}/${name}`).find((file) => {
        try {
            fs.accessSync(file, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
}

function replaceBasePathForDocker(data) {
    return replaceBasePathForDockerUtil(data, state.config.paths.base);
}
