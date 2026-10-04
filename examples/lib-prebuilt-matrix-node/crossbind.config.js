import matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';

export default {
    general: { name: 'crossbind-example-lib-prebuilt-matrix-node' },
    dependencies: [matrix],
    export: {
        bindings: { headers: ['@crossbind/example-lib-prebuilt-matrix/Matrix.h'] },
    },
    paths: {
        config: import.meta.url,
        base: '../..',
        output: 'dist',
    },
};
