import fs from 'node:fs';
import state from '../state/index.js';
import getData from './getData.js';
import { appCompileOptions } from '../utils/appApiHeader.js';

export default function getCmakeParameters(target, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error('invalid options');
    }

    const params = [];
    // if (isBuildBridge) params.push('-DBUILD_BRIDGE=TRUE');

    const dependParams = state.config.dependencyParameters;
    const externalNativeGlob = [
        ...(options.nativeGlob || []),
    ];
    const externalBridgeGlob = [
        `${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`,
        ...(options.bridgeGlob || []),
    ];
    const nativeGlob = [
        `${state.config.paths.cli}/assets/cpp-runtime/crossbindEmptySource.cpp`,
        ...(dependParams.nativeGlob || []),
    ];
    const headerGlob = [
        ...(dependParams.headerGlob || []),
        ...(options.headerGlob || []),
    ];

    const headerDirs = [
        dependParams.headerPathWithDepends,
        ...(options.headerDirs || []),
    ];

    // React Native loads a library on Android as a shared one; an app's host links the project's archives into itself.
    const sharedPlatforms = ['android'];
    const buildType = sharedPlatforms.includes(target.platform) && target.runtimeEnv !== 'app' ? 'SHARED' : 'STATIC';
    const otherBuildType = buildType === 'STATIC' ? 'SHARED' : 'STATIC';

    // An app's own code can tell it is one, to reach <crossbind/app.h>.
    const cmakeCompileOptions = [...new Set([...(getData('cmake', target)?.compileOptions || []), ...appCompileOptions(target)])];

    params.push(...[
        `-DPROJECT_NAME=${options.name || state.config.general.name}`,
        // `-DPACKAGE_NAME_SUFFIX=${target.platform === 'ios' ? `-${target.runtime}-${target.buildType}` : ''}`,
        `-DPROJECT_TARGET_PLATFORM=${target.platform}`,
        `-DPROJECT_TARGET_ARCH=${target.arch}`,
        `-DPROJECT_TARGET_RUNTIME=${target.runtime}`,
        `-DPROJECT_TARGET_HOST=${target.platform}-${target.arch}-${target.runtime}-${target.buildType}`,
        `-DPROJECT_TARGET_HOST_RELEASE=${target.platform}-${target.arch}-${target.runtime}-release`,
        `-DBASE_DIR=${state.config.paths.project}`,
        `-DEXTERNAL_NATIVE_GLOB=${externalNativeGlob.join(';')}`,
        `-DEXTERNAL_BRIDGE_GLOB=${externalBridgeGlob.join(';')}`,
        `-DNATIVE_GLOB=${nativeGlob.join(';')}`,
        `-DHEADER_GLOB=${headerGlob.join(';')}`,
        `-DHEADER_DIR=${headerDirs.join(';')}`,
        `-DDEPENDS_CMAKE_PATHS=${dependParams.getCmakeDependsPathAndName(target).pathsOfCmakeDepends.join(';')}`,
        `-DDEPENDS_CMAKE_NAMES=${dependParams.getCmakeDependsPathAndName(target).nameOfCmakeDepends.join(';')}`,
        `-DBRIDGE_DIR=${state.config.paths.build}/bridge`,
        `-DBUILD_TYPE=${buildType}`,
        `-DBUILD_${otherBuildType}_LIBS=OFF`,
        `-DCOMPILE_OPTIONS=${cmakeCompileOptions.join(';')}`,
        // '-DCMAKE_CXX_COMPILER_LAUNCHER=ccache',
        ...(options.buildSource !== false ? ['-DBUILD_SOURCE=TRUE'] : []),
    ]);

    return params;
}
