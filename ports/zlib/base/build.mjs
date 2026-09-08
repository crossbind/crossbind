export default {
    sha256: 'bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16', // zlib-1.3.2.tar.gz
    // zlib.net drops superseded releases and its edge occasionally serves other bytes; the GitHub asset is stable.
    getURL: (version) => `https://github.com/madler/zlib/releases/download/v${version}/zlib-${version}.tar.gz`,
    buildType: 'cmake',
    getBuildParams: (target) => [
        target.platform === 'android' ? '-DZLIB_BUILD_STATIC=OFF' : '-DZLIB_BUILD_SHARED=OFF',
        '-DZLIB_BUILD_TESTING=OFF',
    ],
};
