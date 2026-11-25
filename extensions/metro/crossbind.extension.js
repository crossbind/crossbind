import wrap from './src/wrap.js';

// crossbind(config) around Metro's config, as Metro has no plugin list: a Metro config has a transformer and a resolver.
export default function metro() {
    return {
        name: 'metro',
        contract: 5,
        root: import.meta.dirname,
        integration: {
            wraps: (config) => typeof config?.transformer === 'object' && typeof config?.resolver === 'object',
            wrap: (api, config) => wrap(api, config),
        },
    };
}
