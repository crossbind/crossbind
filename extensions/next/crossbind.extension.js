import wrap from './src/wrap.js';

// crossbind(config) around a Next.js config, as Next has no plugin list: Next's CLI names its runtime before it loads the
// config.
export default function next() {
    return {
        name: 'next',
        contract: 5,
        root: import.meta.dirname,
        integration: {
            wraps: (config) => Boolean(process.env.NEXT_RUNTIME) && (typeof config === 'function' || (typeof config === 'object' && config !== null)),
            wrap: (api, config) => wrap(api, config),
        },
    };
}
