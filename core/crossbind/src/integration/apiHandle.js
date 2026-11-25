import { ISOLATION_HEADERS } from './isolationHeaders.js';

// The module a tool's worker process imports to make an api of its own, as its default export does: a worker shares no
// memory with the process whose config chose the integration.
const WORKER_MODULE = new URL('./api.js', import.meta.url).href;
// What the api gives before crossbind's state has loaded, as a tool's config may ask for it as it loads.
const CONSTANTS = { workerModule: WORKER_MODULE, isolationHeaders: ISOLATION_HEADERS };

const refuse = (name) => () => {
    throw new TypeError(`crossbind: the api crossbind() gives the ${name} integration does not change.`);
};

// The api an integration gets, before crossbind's state has loaded: a tool loads its config without waiting, and the
// state waits for crossbind.config.js and its dependencies. ready() loads it once and resolves to this api, whose
// members are integrationApi()'s from then on; reading one earlier throws, naming the integration.
export default function apiHandle(name) {
    let api = null;
    let loading = null;
    const ready = () => {
        loading ??= import('./api.js').then(({ default: integrationApi }) => {
            api = integrationApi();
            return handle;
        });
        return loading;
    };
    const handle = new Proxy({}, {
        get(_, key) {
            if (key === 'ready') return ready;
            if (Object.hasOwn(CONSTANTS, key)) return CONSTANTS[key];
            // Awaiting the api, printing it or writing it as JSON reads these: it is no Promise, and has nothing to show.
            if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
            if (!api) throw new Error(`crossbind: the ${name} integration read api.${key} before api.ready() resolved.`);
            return api[key];
        },
        set: refuse(name),
        defineProperty: refuse(name),
        deleteProperty: refuse(name),
    });
    return handle;
}
