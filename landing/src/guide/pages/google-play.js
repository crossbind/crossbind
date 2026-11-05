import { EXTENSIONS_URL, REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;
const TOKEN_CREATOR = 'gcloud iam service-accounts add-iam-policy-binding <e-mail> --member="user:$(gcloud config get-value account)" --role=roles/iam.serviceAccountTokenCreator';

const LISTING = `store/google-play/en-US/
├── title.txt                 at most 30 characters
├── short_description.txt     at most 80
├── full_description.txt      at most 4000
├── video.txt                 a YouTube URL
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
          node-version: 24
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
      - run: npx crossbind app publish -p android
        env:
          CROSSBIND_GOOGLE_PLAY_TOKEN: \${{ steps.google.outputs.access_token }}
          CROSSBIND_ANDROID_KEYSTORE: \${{ secrets.ANDROID_UPLOAD_KEY }}
          CROSSBIND_ANDROID_KEY_ALIAS: upload
          CROSSBIND_ANDROID_KEYSTORE_PASSWORD: \${{ secrets.ANDROID_UPLOAD_KEY_PASSWORD }}`;

export default {
    slug: 'google-play',
    title: 'Google Play',
    description: 'Release an Android app on a Google Play track with one command, signed in with your Google account or a service account, with its listing kept in files.',
    lede: '`crossbind app publish google-play`, or `crossbind app publish -p android`, builds the Android app and releases its bundle on a Google Play track, the internal one unless you name another. It signs in with your Google account on your machine, or with a service account in CI, and in the same edit updates the app\'s store listing from `store/google-play`, with the release\'s notes.',
    blocks: [
        { type: 'h2', id: 'needs', text: 'What it needs' },
        { type: 'p', text: 'Before the build, which takes minutes, the publish checks all it needs:' },
        {
            type: 'ul',
            items: [
                "`app.id`, as Play keeps an app's package name for good;",
                'an [upload key](#upload-key);',
                'credentials Play takes uploads with, from a [sign-in](#sign-in);',
                'and the highest versionCode Play has seen.',
            ],
        },
        {
            type: 'p',
            text: "The build's versionCode is then one above that, or the version's own when that is higher, so one `package.json` version uploads as often as needed; `CROSSBIND_APP_BUILD_NUMBER` overrides both. The bundle goes up with the native debug symbols of its libraries, so a crash in Play Console shows function names; Hermes and fbjni come stripped from their releases, so their frames stay addresses.",
        },

        { type: 'h2', id: 'upload-key', text: 'The upload key' },
        {
            type: 'p',
            text: '`crossbind app upload-key` makes one, with no JDK and no knowledge of keystores needed: an RSA 2048 key valid for 10,000 days, in `~/.crossbind/keys/android-upload.p12`, which `~/.crossbind.json` then names. Its password is 24 random characters it shows once, or one you type, of 15 characters or more. The system keychain keeps the password, so builds sign without asking; `--show-password` prints it again, for another machine or CI.',
        },
        {
            type: 'p',
            text: "Keep a copy of the keystore and its password somewhere safe, such as a password manager: Google Play keeps only the upload key's certificate, and a lost key takes an upload key reset in Play Console, which takes effect 72 hours later. The app's own signing key stays with Google, so its users see no change.",
        },
        {
            type: 'p',
            text: "A key you have, from Android Studio or `keytool`, signs as well: `crossbind app upload-key --use <keystore> [--alias <alias>]` checks that it opens with its password and keeps it the same way. Or the environment names it for each build, before the machine's, as in CI:",
        },
        {
            type: 'table',
            head: ['Variable', 'Value'],
            rows: [
                ['`CROSSBIND_ANDROID_KEYSTORE`', 'The keystore that holds the upload key, or its base64 text, as a CI secret holds it.'],
                ['`CROSSBIND_ANDROID_KEY_ALIAS`', "The key's alias in it."],
                ['`CROSSBIND_ANDROID_KEYSTORE_PASSWORD`', "The keystore's password."],
                ['`CROSSBIND_ANDROID_KEY_PASSWORD`', "The key's password, when it is not the keystore's."],
            ],
        },

        { type: 'h2', id: 'sign-in', text: 'Signing in' },
        {
            type: 'p',
            text: "Google Play takes uploads from your Google account or from a service account. With neither set, a publish on a terminal signs you in to Google: your browser opens Google's page, where you pick the account and allow its Google Play access, and the system keychain keeps the sign-in for later publishes, with a terminal or without. The browser has to run on the same machine, as Google's page sends it back to a port of crossbind's there.",
        },
        {
            type: 'p',
            text: 'The account\'s own rights in Play Console apply, so it needs "Release apps to testing tracks" for the app, as its owner has, and for the production track and the listing the rights [step 3](#setup) names. To sign out, remove crossbind in your Google account, under Security › Your connections to third-party apps & services; the next publish signs in again.',
        },
        {
            type: 'p',
            text: 'A service account is for CI, where no one signs in, and wins over the sign-in where one is set, from the environment or from `~/.crossbind.json` under the same name without `CROSSBIND_` (`crossbind config set GOOGLE_PLAY_SERVICE_ACCOUNT …`). Set one of these, as two stop the publish:',
        },
        {
            type: 'table',
            head: ['Variable', 'Value'],
            rows: [
                ['`CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT`', "The service account's e-mail. Your own gcloud login buys an hour's token of it at each publish, so no key of it exists anywhere."],
                ['`CROSSBIND_GOOGLE_PLAY_KEY`', "The service account's JSON key, where gcloud is not, as in CI: its file, or, from the environment alone, its text."],
                ['`CROSSBIND_GOOGLE_PLAY_TOKEN`', 'An access token of the service account with the androidpublisher scope, from the environment alone, as CI makes one with no key (see [From CI](#ci)). It lasts an hour.'],
            ],
        },

        { type: 'h2', id: 'setup', text: 'Once for each app' },
        {
            type: 'ol',
            items: [
                "In Play Console, create the app, with `app.id` as its package name; Play's API makes none.",
                `For a service account, enable the Google Play Android Developer API in a Google Cloud project and make one there. For \`CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT\`, enable the IAM Service Account Credentials API too, and give your gcloud account the Service Account Token Creator role on the service account: \`${TOKEN_CREATOR}\`. For \`CROSSBIND_GOOGLE_PLAY_KEY\`, make a JSON key of it; an organization may refuse keys (\`iam.disableServiceAccountKeyCreation\`), so use the first way there, or a project with no organization.`,
                'For a service account, invite its e-mail in Play Console, under Users and permissions, with "Release apps to testing tracks" for the app; for the production track also "Release to production, exclude devices, and use Play App Signing", and for the listing "Manage store presence".',
                "Play takes draft releases alone until an app's first release is out, so the first publish leaves its release a draft. Roll it out once in Play Console, under Test and release, and later publishes go out by themselves.",
            ],
        },
        {
            type: 'p',
            text: "On a terminal, the publish asks for what is missing and sets it up before the build: the package name, one both stores take, which it writes into `crossbind.config.js` once you say yes; the upload key, as `crossbind app upload-key` makes it; the Google sign-in, after a yes, and another account's when the one signed in has no release rights for the app; and what only Play Console does, creating the app and inviting a service account, which the publish names before it opens Play Console, and checks again when you press Enter. Without a terminal, as in CI, nothing is asked, and the publish names every missing piece at once.",
        },

        { type: 'h2', id: 'tracks', text: 'Tracks and rollouts' },
        {
            type: 'table',
            head: ['Option', 'What it does'],
            rows: [
                ['`--track`', 'The track the release goes on: `internal` without it, or `alpha`, `beta`, `production` or one of your own.'],
                ['`--draft`', "Leaves the release a draft, which Play Console rolls out, in place of sending it to the track's testers at once."],
                ['`--rollout`', "A staged rollout: `--rollout 10`, or `10%`, gives the release to that percent of the track's users at first, and Play Console raises the share later, under Test and release. `100` releases to every user, as no `--rollout` does."],
            ],
        },
        {
            type: 'p',
            text: "Play stages updates alone, so an app's first release reaches all of its users. A draft reaches none until Play Console rolls it out, so `--draft` and `--rollout` do not go together. A store's options go after its name, and one of another store's is refused.",
        },

        { type: 'h2', id: 'listing', text: 'The listing' },
        {
            type: 'p',
            text: "A project's `store/google-play` folder holds its Google Play listing: a folder per language, named as Play names it (`en-US`, `tr-TR`), with the files fastlane's supply reads:",
        },
        { type: 'code', file: 'store/google-play', code: LISTING },
        {
            type: 'p',
            text: "Each publish sends what the folder has and Play's listing lacks: a language's texts where one differs, its images of a type where Play shows others or in another order, and the release's notes. The listing is the app's, not the track's, so a publish to the internal track sends it as well. What the folder leaves out stays as Play has it, so it may hold the notes alone, or the screenshots. A language Play has no listing in yet takes `title.txt`, `short_description.txt` and `full_description.txt`, which Play makes a listing of.",
        },
        {
            type: 'p',
            text: 'Before the build, the publish stops at an empty text, but for an empty `video.txt`, which takes the video away; at a text longer than Play takes; at two files of one image; and at a file or folder Play takes none of, naming it.',
        },

        { type: 'h2', id: 'ci', text: 'From CI' },
        {
            type: 'p',
            text: "A CI job publishes as a publish without a terminal does: it asks nothing. So publish once on your own machine first, where the publish asks for the app's settings and writes them into `crossbind.config.js`, and commit them. CI then needs the upload key as a base64 secret, which `base64 < <keystore>` prints, with its alias and its password, which `crossbind app upload-key --show-password` prints, and a service account invited in Play Console, through Workload Identity Federation with no key, or its JSON key:",
        },
        { type: 'code', file: '.github/workflows/google-play.yml', code: WORKFLOW },
        {
            type: 'p',
            text: "Workload Identity Federation lets the repository's jobs act as the service account, with no key anywhere; [google-github-actions/auth](https://github.com/google-github-actions/auth) says how to set it up, with `roles/iam.workloadIdentityUser` on the service account for the pool. The pool's provider trusts the tokens GitHub gives every repository's jobs, so give it an attribute condition that admits only yours, such as `assertion.repository_id == '<id>'` with the id `gh api repos/<owner>/<repo> --jq .id` prints.",
        },
        {
            type: 'p',
            text: "The token lasts an hour, so the publish's own job makes it, and it asks for the androidpublisher scope, as the action's default, cloud-platform, does not cover Google Play. With a JSON key instead, give its text, from a secret, in `CROSSBIND_GOOGLE_PLAY_KEY`. Each key goes in as its secret's text, the upload key's as base64, so no step writes it to a file: where a tool takes a file, crossbind writes one only the job's user reads, and removes it when the publish ends.",
        },
        {
            type: 'p',
            text: `The [google-play](${EXTENSIONS_URL}google-play/) extension is this publisher; one of your own listed under that name takes its place ([Extensions](/guide/extensions/#replace)). [app.md](${REFERENCE}#google-play) is the reference behind this page.`,
        },
    ],
};
