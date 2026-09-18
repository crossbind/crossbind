export default {
    sha256: 'b8ece2437692dad44d851c4532723390a5a330990007706be9c8d2b90d294f36', // expat-2.8.4.tar.gz
    getURL: (version) => `https://github.com/libexpat/libexpat/releases/download/R_${version.replaceAll('.', '_')}/expat-${version}.tar.gz`,
    buildType: 'cmake',
    getBuildParams: () => [
        '-DEXPAT_BUILD_TESTS=OFF',
        '-DEXPAT_BUILD_TOOLS=OFF',
        '-DEXPAT_BUILD_EXAMPLES=OFF',
    ],
};
