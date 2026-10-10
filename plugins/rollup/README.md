# @crossbind/plugin-rollup
**crossbind Rollup plugin**  
A tool for seamless C++ integration with the Rollup bundler.

<a href="https://www.npmjs.com/package/@crossbind/plugin-rollup">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/plugin-rollup/beta?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>
<a href="https://crossbind.dev/docs/guide/integrate-into-existing-project/rollup">
    <img alt="Docs - Rollup" src="https://img.shields.io/badge/Docs_-_Rollup-20B2AA?style=for-the-badge" />
</a>

## Integration
To integrate crossbind into your project using Rollup as a bundler, you can utilize the @crossbind/plugin-rollup plugin. Start by installing these package with the following command:

```sh
npm install @crossbind/plugin-rollup@beta --save-dev
```

To enable the plugin, modify the `vite.config.js` file as shown below.

```diff
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
+ import rollupCrossbindPlugin from '@crossbind/plugin-rollup'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
+   rollupCrossbindPlugin(),
  ]
});
```
