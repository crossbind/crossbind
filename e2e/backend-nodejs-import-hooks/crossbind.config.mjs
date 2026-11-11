import Matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';

export default {
    general: {
        name: 'crossbind-e2e-backend-nodejs-import-hooks',
    },
    dependencies: [
        Matrix,
    ],
    packages: {
        cargo: { semver: '1' },
        conan: { zlib: '1.3.2' },
    },
    paths: {
        config: import.meta.url,
        base: '../..',
        output: 'dist',
    },
};
