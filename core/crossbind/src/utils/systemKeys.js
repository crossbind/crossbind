const systemKeys = {
    XCODE_DEVELOPMENT_TEAM: {
        description: 'The unique identifier of the development team used for code signing and app distribution in Xcode.',
        default: '',
    },
    RUNNER: {
        description: 'Where toolchain steps run: DOCKER_RUN, DOCKER_EXEC, LOCAL, or REMOTE on the runners REMOTE_URL and REMOTE_URL_<IMAGE> name; a machine that names none builds on crossbind cloud once signed in with crossbind login. The CROSSBIND_RUNNER environment variable overrides it.',
        options: ['DOCKER_RUN', 'DOCKER_EXEC', 'LOCAL', 'REMOTE'],
        default: 'DOCKER_RUN',
    },
    REMOTE_URL: {
        description: 'Under RUNNER=REMOTE, the runner of every image without an address of its own. Its token comes from the CROSSBIND_TOKEN environment variable. The CROSSBIND_REMOTE_URL environment variable overrides it.',
        default: '',
    },
    REMOTE_URL_WEB: {
        description: 'Under RUNNER=REMOTE, the runner of the web image: wasm builds, wasi builds and the bridge steps of every platform but android. Token: CROSSBIND_TOKEN_WEB. The CROSSBIND_REMOTE_URL_WEB environment variable overrides it.',
        default: '',
    },
    REMOTE_URL_ANDROID: {
        description: 'Under RUNNER=REMOTE, the runner of the android image. Token: CROSSBIND_TOKEN_ANDROID. The CROSSBIND_REMOTE_URL_ANDROID environment variable overrides it.',
        default: '',
    },
    REMOTE_URL_LINUX: {
        description: 'Under RUNNER=REMOTE, the runner of the linux image (linux and linuxmusl builds). Token: CROSSBIND_TOKEN_LINUX. The CROSSBIND_REMOTE_URL_LINUX environment variable overrides it.',
        default: '',
    },
    REMOTE_URL_WINDOWS: {
        description: 'Under RUNNER=REMOTE, the runner of the windows image (win32 builds). Token: CROSSBIND_TOKEN_WINDOWS. The CROSSBIND_REMOTE_URL_WINDOWS environment variable overrides it.',
        default: '',
    },
    CLOUD_URL: {
        description: 'The crossbind cloud that crossbind login, logout and usage talk to. The CROSSBIND_CLOUD_URL environment variable overrides it.',
        default: 'https://api.crossbind.dev',
    },
    WASI_SDK_PATH: {
        description: 'Path to an extracted wasi-sdk (>= 34, wasm32-wasip3 sysroot) that platform:\'wasi\' builds use under RUNNER=LOCAL; the other runners use the sdk in the image. The CROSSBIND_WASI_SDK_PATH environment variable overrides it.',
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
export function assertRunner(runner, name = 'RUNNER') {
    if (!systemKeys.RUNNER.options.includes(runner)) {
        throw new Error(`crossbind: the runner ${runner} is invalid; ${name} is one of ${systemKeys.RUNNER.options.join(', ')}.`);
    }
    return runner;
}
