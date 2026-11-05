import { PROBE_SCHEME } from '../../e2e/launch.mjs';

// The e2e app's probe of the host's services, which src/main.js calls through crossbind/app's invoke, and which gets
// the links of a scheme of its own.
export default function probe() {
    return { name: 'probe', root: import.meta.dirname, app: { urlSchemes: [PROBE_SCHEME], sources: ['probe.cpp'] } };
}
