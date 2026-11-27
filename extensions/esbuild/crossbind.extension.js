import esbuildPlugin from './src/plugin.js';

// crossbind() in esbuild's plugin list, and Bun's: each calls a plugin's setup(build) first, the build's options in
// build.initialOptions.
export default function esbuild() {
    return {
        name: 'esbuild',
        contract: 5,
        root: import.meta.dirname,
        integration: {
            calls: ['setup'],
            claims: ({ key, args }) => key === 'setup' && typeof args?.[0]?.initialOptions === 'object' && typeof args[0].onLoad === 'function',
            plugin: (api) => esbuildPlugin(api),
        },
    };
}
