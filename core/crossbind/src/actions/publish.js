import { DESKTOP_PLATFORMS, appOutputOf, clearAppOutputs } from './buildApp.js';
import { hasTerminal } from '../utils/ask.js';

// The store crossbind app publish sends the app of each mobile platform to, which -p, or CROSSBIND_APP_PLATFORM, names.
export const PLATFORM_STORES = { android: 'google-play', ios: 'app-store' };

// The store the command names first, before Vite's own options, which go on to Vite, or else the one of its platform.
export function storeOf(args, platform, envPlatform) {
    const [first, ...rest] = args;
    const named = first !== undefined && !first.startsWith('-') ? first : null;
    if (named && PLATFORM_STORES[platform] && PLATFORM_STORES[platform] !== named) {
        throw new Error(`crossbind: -p ${platform} names the store ${PLATFORM_STORES[platform]}, not ${named}.`);
    }
    if (named && platform && !PLATFORM_STORES[platform] && Object.values(PLATFORM_STORES).includes(named)) {
        throw new Error(`crossbind: ${named} takes no ${platform} app, which -p ${platform} names.`);
    }
    return { store: named ?? PLATFORM_STORES[platform ?? envPlatform] ?? null, viteArgs: named ? rest : args };
}

// The desktop platform a desktop store's app is built for: the one -p names, else CROSSBIND_APP_PLATFORM's, else this
// machine's.
export function desktopPlatformOf(store, platform, envPlatform, host = process.platform) {
    const named = platform || envPlatform;
    if (named && !Object.values(DESKTOP_PLATFORMS).includes(named)) throw new Error(`crossbind: ${store} takes desktop apps, of macos, linux or windows, not ${named}'s.`);
    return named || DESKTOP_PLATFORMS[host];
}

// Sends an app to a store through its publisher. All the store needs is checked before the build, which takes minutes:
// on a terminal the publisher asks for what is missing and sets it up; without one, as in CI, every missing piece is
// named at once. crossbind then picks the build number, builds the app of the publisher's platform and hands its output
// to the publisher's upload, which may ask for another build, as an iOS app once its user has given Apple's reasons for
// an API it calls.
export default async function publish(publisher, options, { runVite }) {
    const context = { isGuided: hasTerminal(), options };
    const { missing = [], session } = await publisher.check(context);
    if (missing.length > 0) throw new Error(missing.join('\n'));
    const buildNumber = await publisher.buildNumber(context, session);
    for (;;) {
        clearAppOutputs();
        const exitCode = await runVite(['build', ...(options.viteArgs ?? [])], {
            ...process.env,
            ...publisher.buildEnv?.(session),
            CROSSBIND_APP_PLATFORM: publisher.platform,
            ...(buildNumber === null ? {} : { CROSSBIND_APP_BUILD_NUMBER: String(buildNumber) }),
        });
        if (exitCode !== 0) {
            throw Object.assign(new Error(`crossbind: the build ended with exit code ${exitCode}, so nothing went to ${publisher.store}.`), { exitCode });
        }
        const answer = await publisher.upload(context, session, appOutputOf(publisher.platform));
        if (!answer?.isRebuildAsked) return;
    }
}
