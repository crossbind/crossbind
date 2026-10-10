# @crossbind/plugin-vite
**crossbind Vite plugin**  
A tool for seamless C++ integration with the Vite.

<a href="https://www.npmjs.com/package/@crossbind/plugin-vite">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/plugin-vite/beta?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>
<a href="https://crossbind.dev/docs/guide/integrate-into-existing-project/vite">
    <img alt="Docs - Vite" src="https://img.shields.io/badge/Docs_-_Vite-20B2AA?style=for-the-badge" />
</a>

## Integration
To integrate crossbind into your project using Vite, you can utilize the @crossbind/plugin-vite plugin. Start by installing these package with the following command:

```sh
npm install @crossbind/plugin-vite@beta --save-dev
```

To enable the plugin, modify the `vite.config.js` file as shown below.

```diff
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
+ import viteCrossbindPlugin from '@crossbind/plugin-vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
+   viteCrossbindPlugin(),
  ]
});
```
