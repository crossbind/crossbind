export default {
    sha256: '2ba599ae2a257976278e7e71e998433a387bfd18aa7b78678229fd5d84f5e9b8', // zstd-1.6.0.tar.gz
    getURL: (version) => `https://github.com/facebook/zstd/releases/download/v${version}/zstd-${version}.tar.gz`,
    // zstd ships its CMake project under build/cmake/, not at the source root.
    // copyToSource places a thin wrapper CMakeLists.txt at the extracted
    // source root that simply add_subdirectory()s build/cmake.
    copyToSource: { 'assets/CMakeLists.txt': 'CMakeLists.txt' },
    buildType: 'cmake',
    getBuildParams: (target) => {
        const shared = target.platform === 'android';
        return [
            `-DZSTD_BUILD_SHARED=${shared ? 'ON' : 'OFF'}`,
            `-DZSTD_BUILD_STATIC=${shared ? 'OFF' : 'ON'}`,
            '-DZSTD_BUILD_PROGRAMS=OFF',
            '-DZSTD_BUILD_TESTS=OFF',
            '-DZSTD_LEGACY_SUPPORT=OFF',
            '-DZSTD_MULTITHREAD_SUPPORT=OFF',
            '-DZSTD_DISABLE_ASM=ON',
        ];
    },
};
