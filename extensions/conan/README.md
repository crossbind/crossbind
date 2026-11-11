# @crossbind/extension-conan

C and C++ packages from ConanCenter, each built with the toolchain of the target it links into.

crossbind has it as a dependency: there is nothing to install or list.

## Use

```js
// crossbind.config.js
export default {
    packages: {
        conan: { zlib: '1.3.2' },
    },
};
```

```js
import { initNative, zlibVersion } from 'conan:zlib/zlib.h';

await initNative();
zlibVersion(); // '1.3.2'
```

A build runs `conan install` for each of its targets, with a profile of the compilers, flags and C++ standard crossbind builds that target with, and writes the versions it took to `conan.lock`. [conan.md](https://github.com/crossbind/crossbind/blob/main/docs/api/conan.md#declare-then-import) has the options a package takes, what a build does and the license rows.

## Platforms

Web, Android and iOS builds, and Node.js addons for Linux, macOS and Windows. The toolchain images carry Conan; iOS and macOS packages build on your Mac, with the Conan on its `PATH`. [conan.md](https://github.com/crossbind/crossbind/blob/main/docs/api/conan.md#requirement) says which Conan that takes.

## Replace

An extension named `conan` that `crossbind.config.js` lists with a package source of its own takes its place. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#package-sources) says what one gives.
