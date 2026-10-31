export default {
    sha256: '28d74992e0bc0f13ecdda1dd9ca3b40b1a87009369b9ec5a599853f6f311fee7', // v4.3.0.tar.gz
    getURL: (version) => `https://github.com/Esri/lerc/archive/refs/tags/v${version}.tar.gz`,
    buildType: 'cmake',
    // Huffman's trailing decoder read-ahead word is counted in the blob but never written.
    // Zero the allocation so lossless float blobs cannot contain bytes from the heap.
    sourceReplaceList: () => [{
        regex: '\\(unsigned char \\*\\)malloc \\(numBytes \\+ 1\\)',
        replacement: '(unsigned char *)calloc (numBytes + 1, 1)',
        paths: ['src/LercLib/fpl_EsriHuffman.cpp'],
    }],
    // 4.1.1 added a BUILD_SHARED_LIBS option defaulting to ON, so the wasm build emitted
    // libLerc.so and no libLerc.a. Consumers link the static archive on wasm/ios but the
    // shared object on android — pin the option per platform instead of trusting the default.
    getBuildParams: (target) => (target.platform === 'android'
        ? ['-DBUILD_SHARED_LIBS=ON']
        : ['-DBUILD_SHARED_LIBS=OFF']),
};
