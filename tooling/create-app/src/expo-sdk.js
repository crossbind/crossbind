// Expo decides which react-native and expo-* versions go together and republishes its own template with every patch.
// Versions frozen into this package go stale: `expo` floats in a new project, so a later patch can need a react-native
// they do not name, and the app dies at launch on iOS. A new project takes them from Expo's template of its SDK instead.
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const TIMEOUT_MS = 10_000;
const VERSION = '\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?';
const EXACT = new RegExp(`^${VERSION}$`);
const RANGE = new RegExp(`^[~^]?${VERSION}$`);

export async function followExpoSdk(dependencies, { registry = process.env.npm_config_registry || DEFAULT_REGISTRY, request = fetch } = {}) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const manifest = async (path) => {
        const response = await request(`${registry.replace(/\/+$/, '')}/${path}`, { signal });
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return response.json();
    };

    const sdk = dependencies.expo.match(/\d+/)[0];
    const expo = (await manifest(`expo-template-default/sdk-${sdk}`)).dependencies ?? {};
    // What the registry says is written into the project's package.json, so a value that is not a plain version stops
    // here, along with the rest: the versions only work as a set.
    for (const name of Object.keys(dependencies).filter((dependency) => dependency in expo)) {
        if (!RANGE.test(expo[name])) throw new Error(`${name}: unexpected version "${expo[name]}"`);
    }
    const reactNative = expo['react-native'];
    if (!EXACT.test(reactNative)) throw new Error(`react-native: unexpected version "${reactNative}"`);

    // Android compiles the bundle with the hermes-compiler the app declares, which has to match its react-native.
    const hermes = (await manifest(`react-native/${reactNative}`)).dependencies?.['hermes-compiler'];
    if (!EXACT.test(hermes)) throw new Error(`react-native@${reactNative}: unexpected hermes-compiler "${hermes}"`);

    return {
        ...Object.fromEntries(Object.entries(dependencies).map(([name, version]) => [name, expo[name] ?? version])),
        'hermes-compiler': hermes,
    };
}
