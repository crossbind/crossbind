import { initNative, Native, NATIVE_ANSWER } from './native/native.h';
import { Matrix } from '@crossbind/example-lib-prebuilt-matrix/Matrix.h';
import { zlibVersion, compressBound } from 'conan:zlib/zlib.h';
import { Counter } from './native/counter.rs';
import { Version, VersionReq } from 'cargo:semver';

await initNative();
const product = new Matrix(4, 2).multiple(new Matrix(4, 3));
const counter = new Counter(40);
counter.add(2);
const matches = VersionReq.parse('^1.2').matches(Version.parse('1.4.0'));
console.log(`NATIVE ${Native.sample()} | ANSWER ${NATIVE_ANSWER} | MATRIX ${product.get(0)} | ZLIB ${zlibVersion()} ${compressBound(1000)} | RUST ${counter.total()} ${matches}`);
