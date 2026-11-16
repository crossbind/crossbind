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

// What a publish sends of a language: its texts, its images and its release notes.
function languageLine({
    language, texts, images, notes,
}) {
    const parts = [
        Object.keys(texts).map((field) => TEXTS[field]).join(', '),
        Object.entries(images).map(([type, files]) => IMAGES[type] ?? `${files.length} ${SCREENSHOTS[type]}`).join(', '),
        Object.keys(notes).length > 0 ? 'release notes' : '',
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

// What crossbind app store says of Google Play: what a publish sends, what Play would refuse of it, and the steps Play
// Console alone takes, once for the app.
export function playGuide(api) {
    const { listings, settings, problems } = readAll(api.project.root);
    const details = Object.entries(settings.details);
    const sends = [
        'the bundle, signed with the upload key, with its native debug symbols, on a track',
        ...listings.filter((listing) => isListed(listing) || Object.keys(listing.notes).length > 0).map(languageLine),
        ...(details.length > 0 ? [`contact details: ${details.map(([field, text]) => `${DETAILS[field]} ${text}`).join(', ')}`] : []),
        ...(settings.dataSafety === undefined ? [] : [`the Data safety declaration in ${file('data_safety.csv')}`]),
    ];
    const id = api.config.app.id;
    const steps = [
        id === undefined
            ? { text: 'Set app.id in crossbind.config.js, as com.example.myapp, which Play keeps for good as the package name; then create the app in Play Console with it, as Play\'s API makes none.', url: PLAY_CONSOLE }
            : { text: `Create the app, with ${id} as its package name, as Play's API makes none.`, url: PLAY_CONSOLE },
        { text: `Policy and programs › App content › Privacy policy: ${settings.privacyUrl ?? `the policy's URL, which ${file('privacy_url.txt')} would name here`}.` },
        { text: 'Policy and programs › App content: answer App access, Ads, Content rating (the IARC questionnaire), Target audience and content, and each other declaration Play lists for the app.' },
        ...(settings.dataSafety === undefined
            ? [{ text: `Policy and programs › App content › Data safety: answer it; to keep it in the project, export it to CSV as ${file('data_safety.csv')}, which later publishes then send.` }]
            : []),
        { text: `Grow users › Store presence › Store settings › App category: ${settings.category ?? `pick one, which ${file('category.txt')} would name here`}.` },
        ...(settings.details.contactEmail === undefined
            ? [{ text: `Grow users › Store presence › Store settings › Contact details: an e-mail at least, which ${file('contact_email.txt')} would send from the next publish.` }]
            : []),
        { text: 'Test and release › Production › Countries / regions: pick where the app goes. A personal account opened after 13 November 2023 first runs a closed test with 12 testers for 14 days.' },
        { text: 'Test and release: roll out the first release once, which the first publish leaves a draft; later publishes go out by themselves.' },
        { text: 'For CI: Users and permissions › invite the service account, with "Release apps to testing tracks", "Manage store presence" for the listing and details, and "Manage policy declarations" for the Data safety declaration.' },
    ];
    return {
        sends, problems, where: 'Play Console', steps,
    };
}
