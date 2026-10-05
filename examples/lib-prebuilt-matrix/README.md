# @crossbind/example-lib-prebuilt-matrix
**Simple matrix multiplier**  

<a href="https://www.npmjs.com/package/@crossbind/example-lib-prebuilt-matrix">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/example-lib-prebuilt-matrix?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>

## Integration
Start by installing these package with the following command:

```sh
npm install @crossbind/example-lib-prebuilt-matrix
```

To enable the library, modify the crossbind.config.js file as shown below.
```diff
+import matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';

export default {
    dependencies: [
+        matrix
    ]
    paths: {
        config: import.meta.url,
    },
};
```

## Usage
Below are the steps to use the Simple Matrix Multiplier in your C++ or JavaScript code.

### Usage in C++ Code
```diff
+#include <Matrix.h>

std::string Native::sample() {
+    auto firstMatrix = std::make_shared<Matrix>(9, 1);
+    auto secondMatrix = std::make_shared<Matrix>(9, 2);
+    auto resultStr = std::to_string(firstMatrix->multiple(secondMatrix)->get(0));
+    return "J₃ * (2*J₃) = " + resultStr + "*J₃";
}

```

### Usage in JavaScript Code (web, with plugin)
```js
import { initNative, Matrix } from '@crossbind/example-lib-prebuilt-matrix/Matrix.h';

await initNative();
const a = new Matrix(1210000, 1);
const b = new Matrix(1210000, 2);
const result = a.multiple(b);
console.log(result.get(0));
```

### Usage in JavaScript Code (web, without plugin)
```js
import 'node_modules/@crossbind/example-lib-prebuilt-matrix/dist/crossbind-example-lib-prebuilt-matrix.browser.js';

initNative({ path: 'node_modules/@crossbind/example-lib-prebuilt-matrix/dist' }).then(({ Matrix }) => {
    const a = new Matrix(1210000, 1);
    const b = new Matrix(1210000, 2);
    const result = a.multiple(b);
    console.log(result.get(0));
});
```

### Usage in JavaScript Code (Node.js)
The package ships prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, and a WebAssembly build for Node.js. Each entry exports `Matrix` once `initNative()` resolves; `require()` of an entry needs Node.js 22.12 or later.
```js
import { initNative, Matrix } from '@crossbind/example-lib-prebuilt-matrix/node/napi'; // or '/node/wasm'

await initNative();
const a = new Matrix(1210000, 1);
const b = new Matrix(1210000, 2);
console.log(a.multiple(b).get(0));
```

### Usage in JavaScript Code (Cloudflare Workers)
Wrangler bundles the WebAssembly module the entry imports.
```js
import { initNative, Matrix } from '@crossbind/example-lib-prebuilt-matrix/edge/wasm';

export default {
    async fetch() {
        await initNative();
        return new Response(String(new Matrix(4, 2).get(0)));
    },
};
```
