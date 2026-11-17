import { EXTENSIONS_URL, REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;
const REQUIRED_REASONS = 'https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api';

const LISTING = `store/app-store/en-US/
├── name.txt                  at most 30 characters
├── subtitle.txt              at most 30
├── privacy_url.txt           the privacy policy's URL
├── description.txt           at most 4000
├── keywords.txt              at most 100, separated by commas
├── release_notes.txt         what's new in the version, at most 4000
├── promotional_text.txt      at most 170
├── support_url.txt
├── marketing_url.txt
└── screenshots/
    ├── APP_IPHONE_67/          the 6.9-inch and 6.7-inch iPhone's: 01.png, 02.png, at most 10
    ├── APP_IPAD_PRO_3GEN_129/  the 13-inch iPad's
    └── APP_DESKTOP/            the Mac's, which the macOS version takes alone`;

const TESTFLIGHT = `name: Publish to TestFlight
on: workflow_dispatch
jobs:
  publish:
    runs-on: macos-latest
    env:
      CROSSBIND_RUNNER: LOCAL
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - uses: actions/cache@v6
        with:
          path: ~/.crossbind/hermes
          key: hermes-\${{ hashFiles('package-lock.json') }}
      - run: npx crossbind app upload -p ios
        env:
          CROSSBIND_APPLE_API_KEY: \${{ secrets.APPLE_API_KEY }}
          CROSSBIND_APPLE_API_KEY_ID: \${{ vars.APPLE_API_KEY_ID }}
          CROSSBIND_APPLE_API_ISSUER: \${{ vars.APPLE_API_ISSUER }}`;

export default {
    slug: 'app-store',
    title: 'App Store',
    description: 'Upload an iOS app to App Store Connect and TestFlight with one command, hand it to App Review, and keep its listing in files.',
    lede: '`crossbind app upload app-store -p ios` (or `crossbind app upload -p ios`) builds the iOS app on a Mac with Xcode and uploads it to App Store Connect; TestFlight hands it to testers once Apple has processed it, usually within 5 to 30 minutes. Without `-p`, `crossbind app upload app-store` sends the macOS app after it. `--submit` also sends the version to App Review, with its listing.',
    blocks: [
        { type: 'h2', id: 'needs', text: 'What it needs' },
        { type: 'p', text: 'Before the build, the upload checks that it has:' },
        {
            type: 'ul',
            items: [
                "`app.id`, the bundle id, which App Store Connect keeps for good;",
                'the Apple Developer Program team, `app.team` or `XCODE_DEVELOPMENT_TEAM`;',
                '`app.icon`, as App Store Connect takes no app without one.',
            ],
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    target: { runtimeEnv: 'app' },
    app: {
        id: 'com.example.myapp',
        icon: 'icon.png',
        team: 'ABCDE12345',
        encryption: false,
        privacy: { fileTimestamp: ['C617.1'] },
    },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: "Once per app, create it in App Store Connect, under Apps, as a new iOS app with `app.id` as its bundle ID: Apple's API cannot, and uploads fail until the app exists. An upload that finds no app registers the bundle id first, so App Store Connect's form lists it.",
        },
        {
            type: 'p',
            text: "In a terminal, the upload asks for whatever is missing: the bundle id, the icon, `app.encryption` and the reasons of `app.privacy`, which it writes into `crossbind.config.js` once you agree, and the team, which `~/.crossbind.json` keeps. When a step needs Xcode or Apple's website, such as signing in to Xcode again, accepting a new agreement or creating the app, the upload opens that page and retries the upload when you press Enter, without building again. In CI it asks nothing: it lists everything missing and stops.",
        },

        { type: 'h2', id: 'encryption-privacy', text: 'Encryption and privacy' },
        {
            type: 'p',
            text: "`app.encryption` tells App Store Connect whether the app uses encryption that export rules do not exempt; without it, App Store Connect asks about every build before TestFlight takes it. Set it to `false` when the app uses none, or only exempt encryption such as the system's HTTPS, and to `true` when it uses its own. It is a legal statement, so crossbind never sets it on its own.",
        },
        {
            type: 'p',
            text: `App Store Connect refuses an app that calls Apple's required reason APIs without giving reasons (ITMS-91053). The host and Hermes call none, but six of crossbind's ports do, through \`stat\` and its kin: curl, GDAL, OpenSSL, PROJ, SQLite and libtiff. \`app.privacy\` gives the reasons, each category with Apple's codes from [Describing use of required reason API](${REQUIRED_REASONS}), and the build writes them into the app's privacy manifest. The categories are \`fileTimestamp\`, \`systemBootTime\`, \`diskSpace\`, \`activeKeyboards\` and \`userDefaults\`.`,
        },
        {
            type: 'p',
            text: 'Before the upload, the upload checks what the archived app calls and stops at a category without its reason. It finds C functions such as `stat` and `mach_absolute_time`, but not Objective-C selectors such as `systemUptime`.',
        },

        { type: 'h2', id: 'signing', text: 'Signing and build numbers' },
        {
            type: 'p',
            text: "crossbind archives the app unsigned, so archiving needs no development certificate, profile, registered device or Apple account. The account Xcode is signed in to uploads it, and the upload signs the app for distribution in the cloud. The build number is the version's own number at first, then the next free one for each later upload of that version, unless `CROSSBIND_APP_BUILD_NUMBER` sets it. The version is `package.json`'s without its prerelease part, as Apple takes numbers only.",
        },
        {
            type: 'p',
            text: 'With `CROSSBIND_APPLE_API_KEY`, `CROSSBIND_APPLE_API_KEY_ID` and `CROSSBIND_APPLE_API_ISSUER` set, as for [notarizing a macOS app](/guide/installers/#macos), an App Store Connect API key uploads instead of the account, as in CI. Apple signs in the cloud only for an Admin key; a key of another role needs an Apple Distribution certificate in the keychain, which Xcode makes once under Settings › Accounts › Manage Certificates.',
        },
        {
            type: 'p',
            text: "The upload carries the app's and Hermes' debug symbols, so crash reports in App Store Connect and Xcode's Organizer show functions and lines. The archive, the upload's options and its logs stay in `.crossbind/build/app-store/`.",
        },

        { type: 'h2', id: 'review', text: 'App Review' },
        {
            type: 'p',
            text: "`--submit` also hands the version to App Review, through App Store Connect's API, with the API key above of the App Manager or Admin role. Before the build, the upload then also checks that App Store Connect has the app, that the version is not out or in review, and that App Review has no other submission of the app; `app.encryption` has to be set.",
        },
        {
            type: 'p',
            text: "After the upload, it takes the App Store version of `package.json`'s number, renaming the one App Store Connect prepared or making one, and puts the [listing](#listing) into it. It then waits up to an hour for the build to be processed, picks it for the version and submits the version for review. `--phased` releases the approved version in phases over 7 days; without it the version goes out as its release option in App Store Connect says.",
        },
        {
            type: 'p',
            text: "What only App Store Connect does stays there: screenshots of devices the listing has no folder for, app previews, App Privacy answers, price and availability, content rights, export compliance documents, and replies to App Review. `crossbind app store app-store` lists each, with what to enter. The age rating, categories, copyright and App Review's contact go with `--send` and with `--submit`, from the [listing](#listing)'s files.",
        },
        {
            type: 'p',
            text: 'After App Review answers with issues, send a new build with an upload without `--submit`. A submission left with items in it, as an upload that stopped midway leaves one, stops the next upload before its build: submit or remove its items in App Store Connect.',
        },
        { type: 'p', text: '`--track`, `--draft` and `--rollout` belong to other stores ([Google Play](/guide/google-play/#tracks) and [GitHub Releases](/guide/github-releases/)) and stop an App Store publish.' },

        { type: 'h2', id: 'listing', text: 'The listing' },
        {
            type: 'p',
            text: "A project's `store/app-store` folder holds its App Store listing, which goes up with `crossbind app store app-store --send`, with no build, through the API key above, and with `--submit`: a folder per locale, named as App Store Connect names it (`en-US`, `tr`, `zh-Hans`), with these text files and a folder of screenshots per display type:",
        },
        { type: 'code', file: 'store/app-store', code: LISTING },
        {
            type: 'p',
            text: "`--send`, or an upload with `--submit`, sends what differs from App Store Connect, and a locale it has none of gets a new localization; the name, subtitle and privacy policy URL go into the app's information. What the folder leaves out stays as it is, so it may hold the release notes alone. An empty `subtitle.txt`, `promotional_text.txt` or `marketing_url.txt` clears its text. Before anything goes, it stops at any other empty text, a text over App Store Connect's limit, and a file or folder it does not take.",
        },
        {
            type: 'p',
            text: "Each folder under `screenshots/` is named after the API's display type and holds up to 10 .png, .jpg or .jpeg files, in name order: 01.png, 02.png and on to 10.png. Besides `APP_IPHONE_67` and `APP_IPAD_PRO_3GEN_129`, the types are `APP_IPHONE_65`, `APP_IPHONE_61`, `APP_IPHONE_58`, `APP_IPHONE_55`, `APP_IPHONE_47`, `APP_IPHONE_40`, `APP_IPHONE_35`, `APP_IPAD_PRO_3GEN_11`, `APP_IPAD_PRO_129`, `APP_IPAD_105` and `APP_IPAD_97`, and `APP_DESKTOP` for the Mac, 16:10 at 1280 × 800 to 2880 × 1800, which only the macOS version takes. A type's screenshots are sent again where App Store Connect shows others, in another order or unprocessed; a type the folder lacks stays as it is.",
        },
        {
            type: 'p',
            text: 'Before anything goes, `--send` and an upload with `--submit` stop at a file that is no PNG or JPEG image, such as a Git LFS pointer; at a screenshot of a size its type does not take, portrait or turned (`APP_IPHONE_67` takes 1320 × 2868, `APP_IPAD_PRO_3GEN_129` 2064 × 2752); and at a screenshot with transparency. App Store Connect wants 13-inch iPad screenshots of every app that runs on iPads, as crossbind\'s apps do.',
        },
        {
            type: 'p',
            text: "Beside the locales, `copyright.txt`, `primary_category.txt` and `secondary_category.txt` (such as `UTILITIES`), `age_rating.json` with the answers by the API's names, and `review_information/` with App Review's contact go with `--submit` where App Store Connect's differ.",
        },

        { type: 'h2', id: 'mac-app-store', text: 'The Mac App Store' },
        {
            type: 'p',
            text: `\`crossbind app upload app-store -p macos\`, or the upload without \`-p\` after the iOS app, sends the macOS app into the same App Store Connect record, as a universal purchase, once you add its macOS platform there with the + beside the platform in the sidebar. It builds the app in the App Sandbox ([app.md](${REFERENCE}#the-app-sandbox)), without its updater and for macOS 13 or later, and Xcode exports it to App Store Connect as it does the iOS app: Xcode's account or an Admin key signs the app and its installer package in the cloud, so you make no certificate by hand. TestFlight hands it to Mac testers, and \`--submit\` to App Review with the listing's \`APP_DESKTOP\` screenshots; \`crossbind app store app-store\` lists what is left. Full reference: [app.md](${REFERENCE}#mac-app-store).`,
        },

        { type: 'h2', id: 'ci', text: 'From CI' },
        {
            type: 'p',
            text: "CI asks nothing, so upload once on your own machine first: it writes the app's settings into `crossbind.config.js`, which you commit. Set `app.team` there yourself too, as the team the upload asked for stays in this machine's `~/.crossbind.json`.",
        },
        {
            type: 'p',
            text: "CI has no Xcode account, so it uploads with an App Store Connect API key, its `.p8` as a secret: an Admin key, whose uploads Apple signs in the cloud and whose secret can do all an Admin can, or a key of another role with an Apple Distribution certificate imported into the runner's keychain before the upload. The runner needs no development certificate or device.",
        },
        {
            type: 'p',
            text: 'Publishing to TestFlight takes one job on a hosted macOS runner, which needs no Docker:',
        },
        { type: 'code', file: '.github/workflows/testflight.yml', code: TESTFLIGHT },
        {
            type: 'p',
            text: "`CROSSBIND_RUNNER: LOCAL` keeps every build step, such as a Rust crate's, on the runner. The cache saves downloading Hermes and its debug symbols at each run. The key goes in as its secret's text, so no step writes it to a file; where a tool takes a file, crossbind writes one only the job's user can read and removes it when the upload ends.",
        },
        {
            type: 'p',
            text: `The [app-store](${EXTENSIONS_URL}app-store/) extension is this publisher; an extension of yours with that name replaces it ([Extensions](/guide/extensions/#replace)). Full reference: [app.md](${REFERENCE}#app-store-connect).`,
        },
    ],
};
