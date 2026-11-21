// Lets Node load worker modules as wrangler bundles them: `cloudflare:workers` resolves to
// test/support/workers-runtime.mjs, and @cloudflare/containers' own imports, which name no extension, to their .js files.
// FixedLengthStream, a global of workerd's that R2 takes a stream of a known length from, passes its bytes on and fails
// at more or fewer than its length, as workerd's does.
import { register } from 'node:module';

globalThis.FixedLengthStream ??= class FixedLengthStream extends TransformStream {
    constructor(length) {
        let seen = 0;
        super({
            transform(chunk, controller) {
                seen += chunk.byteLength;
                if (seen > length) controller.error(new TypeError(`FixedLengthStream got more than its ${length} bytes`));
                else controller.enqueue(chunk);
            },
            flush(controller) {
                if (seen !== length) controller.error(new TypeError(`FixedLengthStream ended at ${seen} of its ${length} bytes`));
            },
        });
    }
};

const RUNTIME = new URL('./workers-runtime.mjs', import.meta.url).href;

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: ${JSON.stringify(RUNTIME)}, shortCircuit: true };
    if (specifier.startsWith('.') && !specifier.endsWith('.js') && context.parentURL?.includes('/@cloudflare/containers/')) {
        return next(specifier + '.js', context);
    }
    return next(specifier, context);
}`)}`);
