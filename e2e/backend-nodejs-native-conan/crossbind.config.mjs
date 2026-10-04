export default {
    general: {
        name: 'crossbind-e2e-backend-nodejs-native-conan',
    },
    // libcurl declares a define (CURL_STATICLIB) and system libraries, libpng is png16 on Windows.
    conanDependencies: {
        zlib: '1.3.2',
        libpng: '1.6.58',
        fmt: '12.2.0',
        libcurl: { version: '8.22.0', options: { with_ssl: false } },
    },
    paths: {
        config: import.meta.url,
        base: '../..',
        output: 'dist',
    },
};
