import { EXTENSIONS_URL, REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;
const TOKEN_CREATOR = 'gcloud iam service-accounts add-iam-policy-binding <e-mail> --member="user:$(gcloud config get-value account)" --role=roles/iam.serviceAccountTokenCreator';

const LISTING = `store/google-play/en-US/
├── listing.json              title (30 characters), shortDescription (80), video (YouTube URL)
├── full_description.txt      at most 4000
├── changelogs/default.txt    the release's notes, at most 500; <versionCode>.txt for that release alone
└── images/
    ├── icon.png              .png, .jpg or .jpeg, as every image
    ├── featureGraphic.png
    ├── tvBanner.png
    └── phoneScreenshots/     in the order of their names, as 01.png, 02.png; sevenInchScreenshots/,
                              tenInchScreenshots/, tvScreenshots/ and wearScreenshots/ the same`;

const WORKFLOW = `name: Publish to Google Play
on: workflow_dispatch
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - id: google
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: \${{ vars.GOOGLE_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: \${{ vars.GOOGLE_PLAY_SERVICE_ACCOUNT }}
          token_format: access_token
          access_token_scopes: https://www.googleapis.com/auth/androidpublisher
          create_credentials_file: false
      - run: npx crossbind app upload -p android
        env:
          CROSSBIND_GOOGLE_PLAY_TOKEN: \${{ steps.google.outputs.access_token }}
          CROSSBIND_ANDROID_KEYSTORE: \${{ secrets.ANDROID_UPLOAD_KEY }}
          CROSSBIND_ANDROID_KEY_ALIAS: upload
          CROSSBIND_ANDROID_KEYSTORE_PASSWORD: \${{ secrets.ANDROID_UPLOAD_KEY_PASSWORD }}`;

export default {
    slug: 'google-play',
    title: 'Google Play',
    description: 'Release an Android app on a Google Play track with one command, signed in with your Google account or a service account, with its listing kept in files.',
    lede: '`crossbind app upload google-play` (or `crossbind app upload -p android`) builds the Android app and puts it out to the testers of a Google Play testing track, the internal one unless you name another, with the release\'s notes; `crossbind app release google-play` then puts it out on production. It signs in with your Google account on your machine, or with a service account in CI.',
    blocks: [
        { type: 'h2', id: 'needs', text: 'What it needs' },
        { type: 'p', text: 'Before the build, which takes minutes, the upload checks that it has:' },
        {
            type: 'ul',
            items: [
                "`app.id`, the package name, which Play keeps for good;",
                'an [upload key](#upload-key);',
                'credentials Play takes uploads with, from a [sign-in](#sign-in);',
                'and the highest versionCode Play has seen.',
            ],
        },
        {
            type: 'p',
            text: "The build's versionCode is one above that, or the version's own when higher, so one `package.json` version can upload as often as needed; `CROSSBIND_APP_BUILD_NUMBER` overrides both. The bundle carries the native debug symbols of its libraries, so a crash in Play Console shows function names, except in Hermes and fbjni, which ship stripped.",
        },

        { type: 'h2', id: 'upload-key', text: 'The upload key' },
        {
            type: 'p',
            text: '`crossbind app key upload` makes one, with no JDK needed: an RSA 2048 key valid for 10,000 days, in `~/.crossbind/keys/android-upload.p12`. Its password is 24 random characters, shown once, or one you type of 15 characters or more. The system keychain keeps the password, so builds sign without asking; `--show-password` prints it again, for another machine or CI.',
        },
        {
            type: 'p',
            text: "Keep a copy of the keystore and its password somewhere safe, such as a password manager. Google Play keeps only the upload key's certificate: a lost key needs an upload key reset in Play Console, which takes effect 72 hours later. The app's own signing key stays with Google, so its users see no change.",
        },
        {
            type: 'p',
            text: 'A key you already have, from Android Studio or `keytool`, works too: `crossbind app key upload --use <keystore> [--alias <alias>]` checks it and keeps it the same way. Or name it in the environment, which wins over the machine\'s, as in CI:',
        },
        {
            type: 'entries',
            items: [
                { name: '`CROSSBIND_ANDROID_KEYSTORE`', text: 'The keystore that holds the upload key, or its base64 text, as a CI secret holds it.' },
                { name: '`CROSSBIND_ANDROID_KEY_ALIAS`', text: "The key's alias in it." },
                { name: '`CROSSBIND_ANDROID_KEYSTORE_PASSWORD`', text: "The keystore's password." },
                { name: '`CROSSBIND_ANDROID_KEY_PASSWORD`', text: "The key's password, when it is not the keystore's." },
            ],
        },

        { type: 'h2', id: 'sign-in', text: 'Signing in' },
        {
            type: 'p',
            text: 'Google Play takes uploads from your Google account or from a service account. With no service account set, an upload in a terminal signs you in to Google in your browser, and the system keychain keeps the sign-in for later uploads. The browser has to run on the same machine.',
        },
        {
            type: 'p',
            text: 'Your account\'s rights in Play Console apply: it needs "Release apps to testing tracks" for the app, as its owner has, and for the production track and the listing the rights in [step 3](#setup). To sign out, remove crossbind in your Google account, under Security › Your connections to third-party apps & services.',
        },
        {
            type: 'p',
            text: 'A service account is for CI, where no one signs in, and wins over the sign-in when set: in the environment, or in `~/.crossbind/config.json` under the same name without `CROSSBIND_` (`crossbind config set GOOGLE_PLAY_SERVICE_ACCOUNT …`). Set only one of these:',
        },
        {
            type: 'entries',
            items: [
                {
                    name: '`CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT`',
                    text: "The service account's e-mail. Your own gcloud login gets an hour-long token for it at each upload, so no key of it exists anywhere.",
                },
                { name: '`CROSSBIND_GOOGLE_PLAY_KEY`', text: "The service account's JSON key, where there is no gcloud, as in CI: its file, or its text from the environment." },
                {
                    name: '`CROSSBIND_GOOGLE_PLAY_TOKEN`',
                    text: 'An access token of the service account with the androidpublisher scope, from the environment only, as CI makes one with no key ([From CI](#ci)). It lasts an hour.',
                },
            ],
        },

        { type: 'h2', id: 'setup', text: 'Once for each app' },
        {
            type: 'ol',
            items: [
                "In Play Console, create the app with `app.id` as its package name; Play's API cannot.",
                `For a service account, enable the Google Play Android Developer API in a Google Cloud project and create the account there. For \`CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT\`, also enable the IAM Service Account Credentials API and give your gcloud account the Service Account Token Creator role on the service account: \`${TOKEN_CREATOR}\`. For \`CROSSBIND_GOOGLE_PLAY_KEY\`, make a JSON key of it; an organization may refuse keys (\`iam.disableServiceAccountKeyCreation\`), so use the first way there, or a project with no organization.`,
                'For a service account, invite its e-mail in Play Console, under Users and permissions, with "Release apps to testing tracks" for the app; for releases also "Release to production, exclude devices, and use Play App Signing", and for the listing "Manage store presence".',
                "Until an app's first release is out, Play takes only drafts, so the first upload leaves a draft. Roll it out once in Play Console, under Test and release; later uploads go out to their testers by themselves.",
            ],
        },
        {
            type: 'p',
            text: 'In a terminal, the upload asks for whatever is missing (the package name, the upload key, the Google sign-in) and sets it up before the build. When a step needs Play Console, such as creating the app or inviting a service account, the upload opens Play Console and checks again when you press Enter. In CI it asks nothing and lists everything missing.',
        },

        { type: 'h2', id: 'tracks', text: 'Tracks and rollouts' },
        {
            type: 'entries',
            items: [
                { name: '`--track`', text: "The testing track an upload puts the bundle on, out to its testers at once: `alpha`, `beta` or one of your own. `production` is refused, as a release puts out on production what the testers have had.", default: '`internal`' },
            ],
        },
        {
            type: 'p',
            text: "`crossbind app release google-play` puts the newest release the testing tracks have out to testers on the production track, with no build, with its name and release notes, after the [listing](#listing). `--rollout 10` (or `10%`) makes it a staged rollout, which gives it to that share of the users first; raise it later in Play Console, under Test and release. `100` releases to every user, as no `--rollout` does. Play stages only updates, so an app's first release reaches all of its users.",
        },

        { type: 'h2', id: 'listing', text: 'The listing' },
        {
            type: 'p',
            text: "A project's `store/google-play` folder holds its Google Play listing: a folder per language, named as Play names it (`en-US`, `tr-TR`), with these files:",
        },
        { type: 'code', file: 'store/google-play', code: LISTING },
        {
            type: 'p',
            text: "`crossbind app store google-play --send` sends what differs from Play's listing, its texts and images, with no build. The listing is the app's, not the track's, so it goes alone or with a release, and an upload sends only the release's notes from `changelogs/`. What the folder leaves out stays as Play has it. A language Play has no listing in yet needs `title` and `shortDescription` in `listing.json` and a `full_description.txt` file.",
        },
        {
            type: 'p',
            text: 'Before anything goes, `--send` stops at anything Play would refuse: an empty or too long text (an empty `video` string removes the video), two files of one image, a file Play takes none of, an icon other than 512 × 512, a feature graphic other than 1024 × 500, a screenshot whose long side is more than twice its short one (as a 20:9 phone\'s is), and transparency in any image but the icon.',
        },
        {
            type: 'p',
            text: 'Set `contactEmail`, `contactWebsite` and `contactPhone` in `store/google-play/store.json`. The `--send` command sends them along with the Data safety declaration in `data_safety.csv`. The guide displays `privacyUrl` and `category` from the same JSON file for entry in Play Console.',
        },

        { type: 'h2', id: 'ci', text: 'From CI' },
        {
            type: 'p',
            text: "CI asks nothing, so upload once on your own machine first: it writes the app's settings into `crossbind.config.js`, which you commit. CI then needs the upload key as a base64 secret (`base64 < <keystore>`), its alias and its password (`crossbind app key upload --show-password`), and a service account invited in Play Console, through Workload Identity Federation with no key, or its JSON key:",
        },
        { type: 'code', file: '.github/workflows/google-play.yml', code: WORKFLOW },
        {
            type: 'p',
            text: "Workload Identity Federation lets the repository's jobs act as the service account, with no key anywhere; [google-github-actions/auth](https://github.com/google-github-actions/auth) shows how to set it up, with `roles/iam.workloadIdentityUser` on the service account for the pool. The pool's provider trusts the tokens GitHub gives every repository's jobs, so give it an attribute condition that admits only yours, such as `assertion.repository_id == '<id>'` with the id `gh api repos/<owner>/<repo> --jq .id` prints.",
        },
        {
            type: 'p',
            text: "The token lasts an hour, so the upload's own job makes it, with the androidpublisher scope: the action's default, cloud-platform, does not cover Google Play. With a JSON key instead, pass its text from a secret in `CROSSBIND_GOOGLE_PLAY_KEY`. Keys go in as secret text, the upload key's as base64, so no step writes them to a file; where a tool takes a file, crossbind writes one only the job's user can read and removes it when the upload ends.",
        },
        {
            type: 'p',
            text: `The [google-play](${EXTENSIONS_URL}google-play/) extension is this publisher; an extension of yours with that name replaces it ([Extensions](/guide/extensions/#replace)). Full reference: [app.md](${REFERENCE}#google-play).`,
        },
    ],
};
