import rollupPlugin from './src/plugin.js';

// crossbind() in Rollup's plugin list, and Rolldown's: each reads a plugin's options hook before any other.
export default function rollup() {
    return {
        name: 'rollup',
        contract: 5,
        root: import.meta.dirname,
        integration: {
            claims: ({ key, args }) => key === 'options' && args === undefined,
            plugin: (api) => rollupPlugin(api),
        },
    };
}
