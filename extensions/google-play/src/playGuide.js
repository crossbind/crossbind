import path from 'node:path';
import {
    PLAY_LISTING, isListed, playListingProblems, readPlayListing, readPlaySettings,
} from './playListing.js';

const PLAY_CONSOLE = 'https://play.google.com/console';
const TEXTS = {
    title: 'title', shortDescription: 'short description', fullDescription: 'full description', video: 'video',
};
// The images Play takes one of, and the screenshots it takes several of, as crossbind app store names them.
const IMAGES = { icon: 'icon', featureGraphic: 'feature graphic', tvBanner: 'TV banner' };
const SCREENSHOTS = {
    phoneScreenshots: 'phone screenshots',
    sevenInchScreenshots: '7-inch tablet screenshots',
    tenInchScreenshots: '10-inch tablet screenshots',
    tvScreenshots: 'TV screenshots',
    wearScreenshots: 'Wear OS screenshots',
};
const DETAILS = { contactEmail: 'e-mail', contactWebsite: 'website', contactPhone: 'phone' };
const file = (name) => path.join(PLAY_LISTING, name);

// What crossbind app store --send sends of a language: its texts and its images.
function languageLine({ language, texts, images }) {
    const parts = [
        Object.keys(texts).map((field) => TEXTS[field]).join(', '),
        Object.entries(images).map(([type, files]) => IMAGES[type] ?? `${files.length} ${SCREENSHOTS[type]}`).join(', '),
    ].filter(Boolean);
    return `${path.join(PLAY_LISTING, language)}: ${parts.join('; ')}`;
}

// The project's listing and settings, with what stops reading them as a problem of its own.
function readAll(root) {
    const problems = [];
    let listings = [];
    let settings = { details: {} };
    try {
        listings = readPlayListing(root);
        problems.push(...playListingProblems(root, listings));
    } catch (error) {
        problems.push(error.message);
    }
    try {
        settings = readPlaySettings(root);
    } catch (error) {
        problems.push(error.message);
    }
    return { listings, settings, problems };
}

// What crossbind app store says of Google Play: what an upload sends, which is the bundle and its release notes, what
// a release puts out, what --send sends, which is the rest of the page, what Play would refuse of it, and the steps Play
// Console alone takes, once for the app.
export function playGuide(api) {
    const { listings, settings, problems } = readAll(api.project.root);
    const details = Object.entries(settings.details);
    const noted = listings.filter(({ notes }) => Object.keys(notes).length > 0);
    const uploads = [
        'the bundle, signed with the upload key, with its native debug symbols, on a testing track: internal, or the one --track names',
        ...(noted.length > 0 ? [`its release notes in ${noted.map(({ language }) => path.join(PLAY_LISTING, language, 'changelogs')).join(', ')}`] : []),
    ];
    const sends = [
        ...listings.filter(isListed).map(languageLine),
        ...(details.length > 0 ? [`contact details: ${details.map(([field, text]) => `${DETAILS[field]} ${text}`).join(', ')}`] : []),
        ...(settings.dataSafety === undefined ? [] : [`the Data safety declaration in ${file('data_safety.csv')}`]),
    ];
    const releases = [
        "the newest release the testing tracks have out to testers, on production, to the share of users --rollout gives at first",
        'with it, the page --send sends',
    ];
    const id = api.config.app.id;
    const steps = [
        id === undefined
            ? { text: 'Set app.id in crossbind.config.js, as com.example.myapp, which Play keeps for good as the package name; then create the app in Play Console with it, as Play\'s API makes none.', url: PLAY_CONSOLE }
            : { text: `Create the app, with ${id} as its package name, as Play's API makes none.`, url: PLAY_CONSOLE },
        { text: `Policy and programs › App content › Privacy policy: ${settings.privacyUrl ?? `the policy's URL, which ${file('store.json.privacyUrl')} would name here`}.` },
        { text: 'Policy and programs › App content: answer App access, Ads, Content rating (the IARC questionnaire), Target audience and content, and each other declaration Play lists for the app.' },
        ...(settings.dataSafety === undefined
            ? [{ text: `Policy and programs › App content › Data safety: answer it; to keep it in the project, export it to CSV as ${file('data_safety.csv')}, which crossbind app store google-play --send then sends.` }]
            : []),
        { text: `Grow users › Store presence › Store settings › App category: ${settings.category ?? `pick one, which ${file('store.json.category')} would name here`}.` },
        ...(settings.details.contactEmail === undefined
            ? [{ text: `Grow users › Store presence › Store settings › Contact details: an e-mail at least, which ${file('store.json.contactEmail')} would send with crossbind app store google-play --send.` }]
            : []),
        { text: 'Test and release › Production › Countries / regions: pick where the app goes. A personal account opened after 13 November 2023 first runs a closed test with 12 testers for 14 days.' },
        { text: 'Test and release: roll out the first release once, which the first upload leaves a draft; later uploads go out to their testers by themselves, as releases do on production.' },
        { text: 'For CI: Users and permissions › invite the service account, with "Release apps to testing tracks", "Release to production, exclude devices, and use Play App Signing" for releases, "Manage store presence" for the listing and details, and "Manage policy declarations" for the Data safety declaration.' },
    ];
    return {
        uploads, sends, releases, problems, where: 'Play Console', steps,
    };
}
