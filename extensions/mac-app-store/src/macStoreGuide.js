import {
    APP_STORE_CONNECT, APP_STORE_LISTING, appStoreListingProblems, listingOf, readAppStoreListing,
} from '@crossbind/core-store-kit';

const API_KEYS = 'https://appstoreconnect.apple.com/access/integrations/api';

// The project's listing as the macOS version takes it, with what stops reading it as a problem of its own.
function readListing(root) {
    try {
        const listings = listingOf(readAppStoreListing(root), 'MAC_OS');
        return { listings, problems: appStoreListingProblems(root, listings) };
    } catch (error) {
        return { listings: [], problems: [error.message] };
    }
}

// What crossbind app store says of the Mac App Store: what a publish sends, what App Store Connect would refuse of it,
// and the steps it takes once for the app, beside those of the iOS app's record it shares.
export function macStoreGuide(api) {
    const { listings, problems } = readListing(api.project.root);
    const shots = listings.reduce((count, { screenshots }) => count + (screenshots.APP_DESKTOP?.length ?? 0), 0);
    const sends = [
        "the app, sandboxed, in an archive Xcode exports to App Store Connect, which signs it and its installer package in the cloud, as it does an iOS app's, and whose TestFlight hands it to Mac testers once Apple has processed it",
        ...(listings.length > 0 ? [`with --submit, ${APP_STORE_LISTING}'s texts in ${listings.map(({ locale }) => locale).join(', ')} and ${shots} Mac screenshots, with its settings`] : []),
    ];
    if (!api.app.category?.macos) problems.push('crossbind: app.category is not set, and the Mac App Store takes no app without its category.');
    const steps = [
        { text: `The app's record on App Store Connect › the + beside its platform in the sidebar › macOS: ${api.app.id ?? 'the app'} takes the macOS app too, a universal purchase, which stays one once both platforms are approved.`, url: APP_STORE_CONNECT },
        ...(shots > 0 ? [] : [{ text: "The macOS version's screenshots, 16:10 ones of 1280 × 800 to 2880 × 1800, which a locale's screenshots/APP_DESKTOP would send." }]),
        ...(api.app.encryption === null ? [{ text: 'Set app.encryption in crossbind.config.js, whose answer App Store Connect takes of every build.' }] : []),
        { text: "For --submit and CI: Users and Access › Integrations › App Store Connect API: a key of the App Manager or Admin role, as CROSSBIND_APPLE_API_KEY, CROSSBIND_APPLE_API_KEY_ID and CROSSBIND_APPLE_API_ISSUER; CI's uploads take an Admin key, whose uploads Apple signs in the cloud, as Xcode's account does on your Mac.", url: API_KEYS },
    ];
    return {
        sends, problems, where: 'App Store Connect', steps,
    };
}
