import rsbuildPlugin from './src/plugin.js';

// crossbind() in Rsbuild's plugin list: Rsbuild calls a plugin's apply(config, { action }) before its setup(api), and
// setup alone when it runs with no action.
export default function rsbuild() {
    return {
        name: 'rsbuild',
        contract: 5,
        root: import.meta.dirname,
        integration: {
            calls: ['apply', 'setup'],
            claims: ({ key, args }) => (key === 'apply' && typeof args?.[1]?.action === 'string')
                || (key === 'setup' && typeof args?.[0]?.modifyRsbuildConfig === 'function'),
            plugin: (api) => rsbuildPlugin(api),
        },
    };
}
