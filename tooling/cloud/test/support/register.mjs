// Lets Node load worker modules as wrangler bundles them: `cloudflare:workers` resolves to
// test/support/workers-runtime.mjs, and @cloudflare/containers' own imports, which name no extension, to their .js files.
import { register } from 'node:module';

const RUNTIME = new URL('./workers-runtime.mjs', import.meta.url).href;

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: ${JSON.stringify(RUNTIME)}, shortCircuit: true };
    if (specifier.startsWith('.') && !specifier.endsWith('.js') && context.parentURL?.includes('/@cloudflare/containers/')) {
        return next(specifier + '.js', context);
    }
    return next(specifier, context);
}`)}`);
