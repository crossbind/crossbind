export default {
    general: {
        name: 'crossbind-e2e-web-vite-conan',
    },
    // libpng requires zlib, so zlib links either way; it is declared to be importable too.
    conanDependencies: {
        zlib: '1.3.2',
        libpng: '1.6.58',
        fmt: '12.2.0',
    },
    paths: {
        config: import.meta.url,
        base: '../..', /* Delete this line for create-crossbind */
    },
};
