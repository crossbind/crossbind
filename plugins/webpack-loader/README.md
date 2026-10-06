# @crossbind/plugin-webpack-loader
**crossbind Webpack loader**  
A tool for seamless C++ integration with the Webpack bundler.

<a href="https://www.npmjs.com/package/@crossbind/plugin-webpack-loader">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/plugin-webpack-loader?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>
<a href="https://crossbind.js.org/docs/guide/integrate-into-existing-project/webpack">
    <img alt="Docs - React Native" src="https://img.shields.io/badge/Docs_-_Webpack-20B2AA?style=for-the-badge" />
</a>

## Integration
To integrate crossbind into your project using Webpack as a bundler, you can utilize the @crossbind/plugin-webpack-loader plugin. Start by installing these package with the following command:

```sh
npm install @crossbind/plugin-webpack@beta @crossbind/plugin-webpack-loader@beta --save-dev
```

**Webpack**  
To enable the plugin, modify the `webpack.config.js` file as shown below.

```diff
+ const CrossbindWebpackPlugin = require('@crossbind/plugin-webpack');
+ const crossbindWebpackPlugin = new CrossbindWebpackPlugin();
+ const compiler = crossbindWebpackPlugin.getCompiler();

module.exports = {
  //...
  plugins: [
+   crossbindWebpackPlugin,
  ],
  module: {
    rules: [
+     {
+       test: /\.h$/,
+       loader: '@crossbind/plugin-webpack-loader',
+       options: { compiler },
+     }
    ],
  },
};
```

**Rspack**  
To enable the plugin, modify the `rspack.config.mjs` file as shown below.

```diff
+ import CrossbindWebpackPlugin from '@crossbind/plugin-webpack';

+ const crossbindWebpackPlugin = new CrossbindWebpackPlugin();
+ const compiler = crossbindWebpackPlugin.getCompiler();

export default defineConfig({
	module: {
		rules: [
+            {
+                test: /\.h$/,
+                loader: '@crossbind/plugin-webpack-loader',
+                options: { compiler },
+            }
		]
	},
	plugins: [
+         crossbindWebpackPlugin,
	].filter(Boolean),
+     devServer: {
+         watchFiles: compiler.config.paths.native,
+         setupMiddlewares: (middlewares, devServer) => {
+             if (!devServer) {
+                 throw new Error('@rspack/dev-server is not defined');
+             }
+ 
+             middlewares.unshift({
+                 name: '/crossbind.js',
+                 path: '/crossbind.js',
+                 middleware: (req, res) => {
+                     res.sendFile(`${compiler.config.paths.temp}/${compiler.config.general.name}.browser.js`);
+                 },
+             });
+             middlewares.unshift({
+                 name: '/crossbind.wasm',
+                 path: '/crossbind.wasm',
+                 middleware: (req, res) => {
+                     res.send(fs.readFileSync(`${compiler.config.paths.temp}/${compiler.config.general.name}.wasm`));
+                 },
+             });
+ 
+             return middlewares;
+         },
+     },
});
```

**Craco**  
To enable the plugin, create the `craco.config.js` file as shown below.

```js
const fs = require('fs');

module.exports = async function () {
    const { default: CrossbindWebpackPlugin } = await import('@crossbind/plugin-webpack');
    const crossbindWebpackPlugin = new CrossbindWebpackPlugin();
    const compiler = crossbindWebpackPlugin.getCompiler();

    return {
        webpack: {
            plugins: {
                add: [crossbindWebpackPlugin],
            },
            configure: (config) => {
                config.module.rules[1].oneOf = [
                    {
                        test: /\.h$/,
                        loader: '@crossbind/plugin-webpack-loader',
                        options: { compiler },
                    },
                    ...config.module.rules[1].oneOf,
                ];
                return config;
            },
        },
        devServer: (devServerConfig) => {
            devServerConfig.watchFiles = compiler.config.paths.native;
            devServerConfig.onBeforeSetupMiddleware = (devServer) => {
                if (!devServer) {
                  throw new Error('webpack-dev-server is not defined');
                }

                devServer.app.get('/crossbind.js', function (req, res) {
                  res.sendFile(`${compiler.config.paths.temp}/${compiler.config.general.name}.browser.js`);
                });

                devServer.app.get('/crossbind.wasm', function (req, res) {
                    res.send(fs.readFileSync(`${compiler.config.paths.temp}/${compiler.config.general.name}.wasm`));
                });
            };

            return devServerConfig;
        },
    };
};
```
