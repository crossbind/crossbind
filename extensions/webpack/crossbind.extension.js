import webpackPlugin from './src/plugin.js';

// crossbind() in webpack's plugin list, and Rspack's: each calls a plugin's apply(compiler) first.
export default function webpack() {
    return {
        name: 'webpack',
        contract: 5,
        root: import.meta.dirname,
        integration: {
            calls: ['apply'],
            claims: ({ key, args }) => key === 'apply' && typeof args?.[0]?.hooks === 'object' && typeof args[0].options === 'object',
            plugin: (api) => webpackPlugin(api),
        },
    };
}
