import { EXTENSIONS_URL, REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;

export default {
    slug: 'github-releases',
    title: 'GitHub Releases',
    description: "Put a desktop app's installers and its update into the GitHub release of its version, from your machine or a workflow.",
    lede: "`crossbind app publish github` builds a desktop app and puts what installs it into the GitHub release of its version, tagged `v` and `package.json`'s version. With `app.updater` the release takes the update too, so an app whose `app.updater.url` points at the release updates from the newest one GitHub has out.",
    blocks: [
        { type: 'h2', id: 'publish', text: 'Publish' },
        {
            type: 'p',
            text: "`-p` names the platform, `macos`, `linux` or `windows`; without it, `CROSSBIND_APP_PLATFORM`, else this machine's. A Mac builds all three, the Linux and Windows apps in crossbind's Docker images:",
        },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind app publish github -p macos --draft
crossbind app publish github -p linux --draft
crossbind app publish github -p windows`,
        },
        {
            type: 'p',
            text: "The release takes the files of each installer: a macOS one under the app's name with its platform and arch, such as `<name>-darwin-<arch>.dmg`, so one release holds both arches', and the others under their own names, as the Debian package, the tar.gz, the Windows setup and the zip. Two files of one name stop the publish before any goes up.",
        },
        {
            type: 'p',
            text: "A repository without a release of the tag gets one, a draft until its files are up. It is tagged at the commit `GITHUB_SHA` names in a workflow of the repository itself; outside a workflow, at the project's own commit, where its git origin is the repository; and else at the repository's default branch. GitHub writes its notes from the changes since the last release, and a version such as 1.2.3-beta.1 makes a prerelease.",
        },
        {
            type: 'p',
            text: "A publish takes a release another one made during its build, as the jobs of a matrix do, and publishes that make theirs at once agree on the oldest. A file of a name the release has already takes the old one's place, so a publish runs again as it did, unless the repository makes its releases immutable.",
        },

        { type: 'h2', id: 'updates', text: 'Updates from the release' },
        {
            type: 'p',
            text: 'With `app.updater` the release takes the [update](/guide/updates/) too: its manifest and the file it names, which `CROSSBIND_UPDATER_PRIVATE_KEY` signs. Point the updater at the newest release:',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    target: { runtimeEnv: 'app' },
    app: {
        updater: {
            url: 'https://github.com/<owner>/<repo>/releases/latest/download/my-app-{platform}-{arch}.update.json',
            publicKey: '<what crossbind app updater-key prints>',
        },
    },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: "A release that is out holds the files its publishes have put up so far, and the newest one out is the one apps update from. So put each platform's app up with `--draft` first, as above, then the release out with a publish without it. GitHub then makes the release the latest unless it has a newer version out, so a fix of an older line leaves the newest one latest. `gh release edit v<version> --draft=false` makes it the latest whatever its version, and so may GitHub's page, as its \"Set as the latest release\" box says; `gh api --method PATCH repos/<owner>/<repo>/releases/<id> -f draft=false -f make_latest=legacy` puts it out as a publish does, with the id `gh release view v<version> --json databaseId -q .databaseId` prints.",
        },
        {
            type: 'p',
            text: "GitHub makes the release it puts out the latest unless it has a newer version out, so a fix of an older line leaves the newest one latest. It makes no prerelease the latest, so apps update to none, and an app fetches no release of a private repository, which takes a token. The publish warns of both, and where `app.updater.url` is not the newest release's address.",
        },

        { type: 'h2', id: 'token', text: 'The token and the repository' },
        {
            type: 'p',
            text: "GitHub takes the release from a token with write access to the repository's contents: `GH_TOKEN` or `GITHUB_TOKEN`, else the sign-in of the GitHub CLI, `gh`. The build gets neither, as it writes nothing to GitHub. The repository is `CROSSBIND_GITHUB_REPOSITORY`, else `GITHUB_REPOSITORY`, which GitHub Actions sets, else `package.json`'s `repository`. Before the build, the publish names every one of them that is missing, and the updater's private key where `app.updater` takes one.",
        },

        { type: 'h2', id: 'ci', text: 'From CI' },
        {
            type: 'p',
            text: "In a workflow, the job's own token does: give it to the step as `GITHUB_TOKEN: ${{ github.token }}`, with the job's `permissions: contents: write`, and with `app.updater` the private key as a secret in `CROSSBIND_UPDATER_PRIVATE_KEY`.",
        },
        {
            type: 'p',
            text: '[winget and the Microsoft Store](/guide/winget-microsoft-store/) take the Windows setups from each release that is out.',
        },
        {
            type: 'p',
            text: `The [github](${EXTENSIONS_URL}github/) extension is this publisher; one of your own listed under that name takes its place ([Extensions](/guide/extensions/#replace)). [app.md](${REFERENCE}#github-releases) is the reference behind this page.`,
        },
    ],
};
