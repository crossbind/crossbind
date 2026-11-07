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
    └── APP_IPAD_PRO_3GEN_129/  the 13-inch iPad's`;

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
      - run: npx crossbind app publish -p ios
        env:
          CROSSBIND_APPLE_API_KEY: \${{ secrets.APPLE_API_KEY }}
          CROSSBIND_APPLE_API_KEY_ID: \${{ vars.APPLE_API_KEY_ID }}
          CROSSBIND_APPLE_API_ISSUER: \${{ vars.APPLE_API_ISSUER }}`;

export default {
    slug: 'app-store',
    title: 'App Store',
    description: 'Upload an iOS app to App Store Connect and TestFlight with one command, hand it to App Review, and keep its listing in files.',
    lede: '`crossbind app publish app-store`, or `crossbind app publish -p ios`, builds the iOS app, archives it with `xcodebuild` and uploads it to App Store Connect, whose TestFlight hands it to testers once Apple has processed it, usually within 5 to 30 minutes. It runs on macOS, with Xcode. `--submit` sends the version on to App Review, with its listing.',
    blocks: [
        { type: 'h2', id: 'needs', text: 'What it needs' },
        { type: 'p', text: 'Before the build, the publish checks that it has:' },
        {
            type: 'ul',
            items: [
                "`app.id`, as App Store Connect keeps an app's bundle id for good;",
                'the Apple Developer Program team, `app.team` or `XCODE_DEVELOPMENT_TEAM`;',
                '`app.icon`, as App Store Connect takes no app without an icon.',
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
            text: "Once for each app, create it in App Store Connect, under Apps, as a new iOS app with `app.id` as its bundle ID: Apple's API makes none, and the upload fails until the app is there. A publish that finds no app registers the bundle id with Apple first, so App Store Connect's form lists it.",
        },
        {
            type: 'p',
            text: "On a terminal, the publish asks for what is missing and sets it up: the bundle id, the icon, `app.encryption` and the reasons of `app.privacy`, which it writes into `crossbind.config.js` once you say yes, and the team, one of those the accounts Xcode is signed in to have or one you type, which `~/.crossbind.json` keeps. What only Xcode or Apple's sites do, such as signing in to Xcode again, accepting a new Program License Agreement or creating the app, a failed upload names: the publish opens the page where crossbind knows it, and tries again when you press Enter, without building again. Without a terminal, as in CI, nothing is asked: the publish names every missing piece at once and stops at the first failure.",
        },

        { type: 'h2', id: 'encryption-privacy', text: 'Encryption and privacy' },
        {
            type: 'p',
            text: "`app.encryption` tells App Store Connect whether the app uses encryption that export rules do not exempt; without it, App Store Connect asks about every build before TestFlight takes it. Set it to `false` when the app uses none, or only what is exempt, such as the system's HTTPS, and to `true` when it uses its own. It is a legal statement, so crossbind sets none by itself, and the publish takes a plain y or n for it.",
        },
        {
            type: 'p',
            text: `App Store Connect refuses an app that calls Apple's required reason API without its reasons (ITMS-91053). The host and Hermes call none, but six of crossbind's ports do, through \`stat\` and its kin: curl, GDAL, OpenSSL, PROJ, SQLite and libtiff. \`app.privacy\` gives the reasons, each category with Apple's codes from [Describing use of required reason API](${REQUIRED_REASONS}), and the build writes them into the app's privacy manifest. The categories are \`fileTimestamp\`, \`systemBootTime\`, \`diskSpace\`, \`activeKeyboards\` and \`userDefaults\`.`,
        },
        {
            type: 'p',
            text: 'The publish reads what the archived app calls, and a category without its reason stops it before the upload, which App Store Connect would refuse. The scan finds C functions, such as `stat` and `mach_absolute_time`, but not Objective-C selectors, such as `systemUptime`.',
        },

        { type: 'h2', id: 'signing', text: 'Signing and build numbers' },
        {
            type: 'p',
            text: "crossbind archives the app unsigned and signs it ad hoc, so archiving takes no development certificate, profile, registered device or Apple account. The account Xcode is signed in to then uploads it: the upload signs the app for distribution, in the cloud, and numbers the build, with the version's own number at first and the next free one for each later upload of that version, unless `CROSSBIND_APP_BUILD_NUMBER` gives one. The version is `package.json`'s, without its prerelease part, as Apple takes numbers alone.",
        },
        {
            type: 'p',
            text: 'With `CROSSBIND_APPLE_API_KEY`, `CROSSBIND_APPLE_API_KEY_ID` and `CROSSBIND_APPLE_API_ISSUER` set, as for [notarizing a macOS app](/guide/installers/#macos), an App Store Connect API key uploads in place of the account, as in CI. Apple signs in the cloud for an Admin key alone; a key of another role needs an Apple Distribution certificate in the keychain, which Xcode makes once under Settings › Accounts › Manage Certificates.',
        },
        {
            type: 'p',
            text: "The upload carries the app's dSYM, with the files and lines of the host and of your code, and Hermes' dSYM, so crash reports in App Store Connect and Xcode's Organizer show functions and lines. crossbind downloads Hermes' dSYM before the first build, from Maven Central, and checks it against the sha256 it pins. The archive, the upload's options and both logs stay in `.crossbind/build/app-store/`.",
        },

        { type: 'h2', id: 'review', text: 'App Review' },
        {
            type: 'p',
            text: "`--submit` hands the version to App Review too, through App Store Connect's API, which takes the API key above, of the App Manager or Admin role. Before the build, the publish then also checks that App Store Connect has the app, that the version takes another build, which none out or in review does, and that App Review has no other submission of the app; and it stops without `app.encryption`, whose answer App Review takes with every build.",
        },
        {
            type: 'p',
            text: "After the upload it takes the App Store version of `package.json`'s number, renaming the one App Store Connect prepared under another number or making one, and puts the [listing](#listing) into it. It then waits for App Store Connect to process the build, an hour at most, picks the build for the version and submits the version for review. `--phased` releases the version App Review approves in phases over 7 days, as App Store Connect's phased release does; without it the version goes out as its release option in App Store Connect says.",
        },
        {
            type: 'p',
            text: "What only App Store Connect does stays there: the first version's age rating, screenshots of devices other than iPhones and iPads, app previews, App Privacy answers, price, category and copyright, App Review's contact, the export compliance documents an app that uses encryption takes, and a reply to App Review. A submission App Review answered with issues takes a new build from a publish without `--submit`. A submission left with items in it, as a publish stopped midway leaves one, stops the next publish before its build: submit or remove them in App Store Connect.",
        },
        { type: 'p', text: '`--track`, `--draft` and `--rollout` belong to other stores, [Google Play](/guide/google-play/#tracks) and, for `--draft`, [GitHub Releases](/guide/github-releases/), and stop an iOS publish.' },

        { type: 'h2', id: 'listing', text: 'The listing' },
        {
            type: 'p',
            text: "A project's `store/app-store` folder holds its App Store listing, which goes up with `--submit`: a folder per locale, named as App Store Connect names it (`en-US`, `tr`, `zh-Hans`), with the text files fastlane's deliver reads and a folder of screenshots per display type:",
        },
        { type: 'code', file: 'store/app-store', code: LISTING },
        {
            type: 'p',
            text: "The version takes what the folder has where App Store Connect's own differs, and a locale it has none of gets a new localization; the name, subtitle and privacy policy URL go into the app's information that changes with the version. What the folder leaves out stays as App Store Connect has it, so it may hold the release notes alone. An empty `subtitle.txt`, `promotional_text.txt` or `marketing_url.txt` clears its text. Before the build, the publish stops at another empty text, at a text longer than App Store Connect takes, and at a file or folder it takes none of, naming it.",
        },
        {
            type: 'p',
            text: "Each folder under `screenshots/` is named as App Store Connect's API names the display type, and holds up to 10 .png, .jpg or .jpeg files, in the order of their names: 01.png, 02.png and on to 10.png. Besides `APP_IPHONE_67` and `APP_IPAD_PRO_3GEN_129`, the types are `APP_IPHONE_65`, `APP_IPHONE_61`, `APP_IPHONE_58`, `APP_IPHONE_55`, `APP_IPHONE_47`, `APP_IPHONE_40`, `APP_IPHONE_35`, `APP_IPAD_PRO_3GEN_11`, `APP_IPAD_PRO_129`, `APP_IPAD_105` and `APP_IPAD_97`. A type's screenshots go up anew where App Store Connect shows others, in another order or unprocessed, and a type the folder has none of stays as it is. A file that holds no PNG or JPEG image, such as an empty one or a Git LFS pointer, stops the publish before the build.",
        },

        { type: 'h2', id: 'ci', text: 'From CI' },
        {
            type: 'p',
            text: "A CI job publishes as a publish without a terminal does: it asks nothing. So publish once on your own machine first, where the publish asks for the app's settings and writes them into `crossbind.config.js`, and commit them. Set `app.team` there yourself as well: the team the publish asked for stays in this machine's `~/.crossbind.json`, as `XCODE_DEVELOPMENT_TEAM`.",
        },
        {
            type: 'p',
            text: "CI has no Xcode account, so it uploads with an App Store Connect API key, its `.p8` as a secret: an Admin key, whose uploads Apple signs in the cloud and whose secret can do all an Admin can, or a key of another role with an Apple Distribution certificate imported into the runner's keychain before the publish. The archive is unsigned, so the runner needs no development certificate or device.",
        },
        {
            type: 'p',
            text: 'Publishing to TestFlight takes one job on a hosted macOS runner. The runner has no Docker and needs none: on a Mac, crossbind makes a macOS or iOS build\'s bridges with `@crossbind/bridge-tools`, which npm installs with crossbind there.',
        },
        { type: 'code', file: '.github/workflows/testflight.yml', code: TESTFLIGHT },
        {
            type: 'p',
            text: "`CROSSBIND_RUNNER: LOCAL` keeps the build's other steps, such as a Rust crate's, on the runner and its Xcode. The cache keeps Hermes and its dSYM, which every upload carries, from downloading again at each run. The key goes in as its secret's text, so no step writes it to a file: where a tool takes a file, crossbind writes one only the job's user reads, and removes it when the publish ends.",
        },
        {
            type: 'p',
            text: `The [app-store](${EXTENSIONS_URL}app-store/) extension is this publisher; one of your own listed under that name takes its place ([Extensions](/guide/extensions/#replace)). [app.md](${REFERENCE}#app-store-connect) is the reference behind this page.`,
        },
    ],
};
