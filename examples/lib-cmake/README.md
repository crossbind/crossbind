# @crossbind/example-lib-cmake
**crossbind sample library: simple cmake library**  

<a href="https://www.npmjs.com/package/@crossbind/example-lib-cmake">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/example-lib-cmake/beta?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>

## Integration
Start by installing these package with the following command:

```sh
npm install @crossbind/example-lib-cmake@beta
```

To enable the library, modify the crossbind.config.js file as shown below.
```diff
+import cmakeSample from '@crossbind/example-lib-cmake/crossbind.config.js';

export default {
    dependencies: [
+        cmakeSample
    ]
    paths: {
        config: import.meta.url,
    },
};
```

## Usage
Below are the steps to use the library in your C++ or JavaScript code.

### Usage in C++ Code
```diff
+#include <crossbind-lib-samplebasic-cmake/samplebasiccmake.h>

std::string Native::sample() {
+    return SampleBasicCmake::sample();
}

```

### Usage in JavaScript Code (web, with plugin)
```js
import { initNative, SampleBasicCmake } from '@crossbind/example-lib-cmake/crossbind-lib-samplebasic-cmake/samplebasiccmake.h';

await initNative();
console.log(SampleBasicCmake.sample());
```
