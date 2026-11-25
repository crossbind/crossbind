import vitePlugin from './src/plugin.js';

// crossbind() in Vite's plugin list: Vite calls a plugin's apply(config, env) first, env.command 'serve' or 'build'.
export default function vite() {
    return {
        name: 'vite',
        contract: 5,
        root: import.meta.dirname,
        integration: {
            calls: ['apply'],
            claims: ({ key, args }) => key === 'apply' && typeof args?.[1]?.command === 'string',
            plugin: (api) => vitePlugin(api),
        },
    };
}
