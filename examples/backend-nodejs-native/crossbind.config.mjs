import Matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';

export default {
    general: {
        name: 'crossbind-example-backend-nodejs-native',
    },
    dependencies: [
        Matrix,
    ],
    paths: {
        config: import.meta.url,
        base: '../..', /* Delete this line for create-crossbind */
        output: 'dist',
    },
};
