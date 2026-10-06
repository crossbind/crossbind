const systemKeys = {
    XCODE_DEVELOPMENT_TEAM: {
        description: 'The unique identifier of the development team used for code signing and app distribution in Xcode.',
        default: '',
    },
    RUNNER: {
        description: 'The execution environment for running the application.',
        options: ['DOCKER_RUN', 'DOCKER_EXEC', 'LOCAL'],
        default: 'DOCKER_RUN',
    },
    WASI_SDK_PATH: {
        description: 'Path to an extracted wasi-sdk (>= 34, wasm32-wasip3 sysroot) used by platform:\'wasi\' builds. The CROSSBIND_WASI_SDK_PATH environment variable overrides it.',
        default: '',
    },
    DOCKER_REGISTRY_MIRROR: {
        description: 'Registry prefix to pull the build images from, e.g. registry.example.dev/crossbind. crossbind appends the release digest itself, so reproducibility is preserved. The CROSSBIND_REGISTRY_MIRROR environment variable overrides it.',
        default: '',
    },
    DOCKER_IMAGE_WEB: {
        description: 'Image reference used for wasm and wasi builds instead of the pinned one. A reference without the release digest disables the reproducibility guarantee. The CROSSBIND_IMAGE_WEB environment variable overrides it.',
        default: '',
    },
    DOCKER_IMAGE_ANDROID: {
        description: 'Image reference used for android builds instead of the pinned one. A reference without the release digest disables the reproducibility guarantee. The CROSSBIND_IMAGE_ANDROID environment variable overrides it.',
        default: '',
    },
    DOCKER_IMAGE_LINUX: {
        description: 'Image reference used for linux (Node.js addon) builds instead of the pinned one. A reference without the release digest disables the reproducibility guarantee. The CROSSBIND_IMAGE_LINUX environment variable overrides it.',
        default: '',
    },
    DOCKER_IMAGE_WINDOWS: {
        description: 'Image reference used for win32 (Node.js addon) builds instead of the pinned one. A reference without the release digest disables the reproducibility guarantee. The CROSSBIND_IMAGE_WINDOWS environment variable overrides it.',
        default: '',
    },
};

export default systemKeys;

// Read as LOCAL, a runner crossbind does not know would run recipes and build scripts on the host.
export function assertRunner(runner) {
    if (!systemKeys.RUNNER.options.includes(runner)) {
        throw new Error(`crossbind: the runner ${runner} is invalid; RUNNER is one of ${systemKeys.RUNNER.options.join(', ')}.`);
    }
    return runner;
}
