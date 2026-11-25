import Matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';
import reactNative from '@crossbind/extension-react-native/crossbind.extension.js';

export default {
    dependencies: [
        Matrix,
    ],
    extensions: [
        reactNative(),
    ],
    paths: {
        config: import.meta.url,
        base: '../..', /* Delete this line for create-crossbind */
    },
};
