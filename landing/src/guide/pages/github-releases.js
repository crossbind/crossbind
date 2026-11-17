import { EXTENSIONS_URL, REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;

export default {
    slug: 'github-releases',
    title: 'GitHub Releases',
    description: "Put a desktop app's installers and its update into the GitHub release of its version, from your machine or a workflow.",
    lede: "`crossbind app publish github` builds a desktop app and uploads its installers to the GitHub release of its version, tagged `v` and `package.json`'s version. With `app.updater` the release also carries the update, so apps can update from the newest release.",
    blocks: [
        { type: 'h2', id: 'publish', text: 'Publish' },
        {
            type: 'p',
            text: "`-p` names the platform: `macos`, `linux` or `windows`; without it, `CROSSBIND_APP_PLATFORM`, else this machine's. A Mac builds all three, Linux and Windows in Docker:",
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
            text: "The release gets every installer's files: the macOS ones named with platform and arch, such as `<name>-darwin-<arch>.dmg`, so one release holds both arches, and the others under their own names. Two files with one name stop the publish before anything uploads.",
        },
        {
            type: 'p',
            text: "Without a release for the tag, the publish makes one, a draft until its files are up. The tag points at `GITHUB_SHA` in a workflow of the repository, else at the project's commit when its git origin is the repository, else at the default branch. GitHub writes the notes from the changes since the last release, and a version such as 1.2.3-beta.1 makes a prerelease.",
        },
        {
            type: 'p',
            text: "Publishes that run at once, as a matrix's jobs do, share one release. A file with a name the release already has replaces the old one, so a publish can run again, unless the repository's releases are immutable.",
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
            publicKey: '<what crossbind app key updater prints>',
        },
    },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: 'Apps update from the newest published release, so upload each platform with `--draft` first, as above, and publish the release with the last upload, without `--draft`. To publish a draft by hand the way a publish does, run `gh api --method PATCH repos/<owner>/<repo>/releases/<id> -f draft=false -f make_latest=legacy`, with the id `gh release view v<version> --json databaseId -q .databaseId` prints. (`gh release edit --draft=false` and GitHub\'s page make it the latest whatever its version.)',
        },
        {
            type: 'p',
            text: 'GitHub makes a published release the latest unless a newer version is out, so a fix of an older line leaves the newest one latest. It never makes a prerelease the latest, so apps do not update to one, and apps cannot fetch a release of a private repository, which takes a token. The publish warns of both, and when `app.updater.url` is not the newest release\'s address.',
        },

        { type: 'h2', id: 'token', text: 'The token and the repository' },
        {
            type: 'p',
            text: "The upload needs a token with write access to the repository's contents: `GH_TOKEN` or `GITHUB_TOKEN`, else the sign-in of the GitHub CLI, `gh`. The build itself never gets the token. The repository is `CROSSBIND_GITHUB_REPOSITORY`, else `GITHUB_REPOSITORY` (GitHub Actions sets it), else `package.json`'s `repository`. The publish checks them all before the build, with the updater's private key where `app.updater` needs one.",
        },

        { type: 'h2', id: 'ci', text: 'From CI' },
        {
            type: 'p',
            text: "In a workflow, the job's own token works: pass `GITHUB_TOKEN: ${{ github.token }}` to the step, with `permissions: contents: write` on the job, and with `app.updater` the private key from a secret in `CROSSBIND_UPDATER_PRIVATE_KEY`.",
        },
        {
            type: 'p',
            text: '[winget and the Microsoft Store](/guide/winget-microsoft-store/) take the Windows setups from each release that is out.',
        },
        {
            type: 'p',
            text: `The [github](${EXTENSIONS_URL}github/) extension is this publisher; an extension of yours with that name replaces it ([Extensions](/guide/extensions/#replace)). Full reference: [app.md](${REFERENCE}#github-releases).`,
        },
    ],
};
