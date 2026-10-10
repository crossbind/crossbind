# @crossbind/example-lib-source
**crossbind sample library: simple source library**  

<a href="https://www.npmjs.com/package/@crossbind/example-lib-source">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/example-lib-source/beta?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>

## Integration
Start by installing these package with the following command:

```sh
npm install @crossbind/example-lib-source@beta
```

To enable the library, modify the crossbind.config.js file as shown below.
```diff
+import sourceSample from '@crossbind/example-lib-source/crossbind.config.js';

export default {
    dependencies: [
+        sourceSample
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
+#include <crossbind-lib-samplebasic/samplebasic.h>

std::string Native::sample() {
+    return SampleBasic::sample();
}

```

### Usage in JavaScript Code (web, with plugin)
```js
import { initNative, SampleBasic } from '@crossbind/example-lib-source/crossbind-lib-samplebasic/samplebasic.h';

await initNative();
console.log(SampleBasic.sample());
```
