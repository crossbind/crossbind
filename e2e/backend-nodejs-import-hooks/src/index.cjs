const native = require('./native/native.h');
const matrix = require('@crossbind/example-lib-prebuilt-matrix/Matrix.h');
const zlib = require('conan:zlib/zlib.h');
const counterModule = require('./native/counter.rs');
const semver = require('cargo:semver');

native.initNative().then(() => {
    const product = new matrix.Matrix(4, 2).multiple(new matrix.Matrix(4, 3));
    const counter = new counterModule.Counter(40);
    counter.add(2);
    const matches = semver.VersionReq.parse('^1.2').matches(semver.Version.parse('1.4.0'));
    console.log(`NATIVE ${native.Native.sample()} | ANSWER ${native.NATIVE_ANSWER} | MATRIX ${product.get(0)} | ZLIB ${zlib.zlibVersion()} ${zlib.compressBound(1000)} | RUST ${counter.total()} ${matches}`);
});
