import { EXTENSIONS_URL, REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;

export default {
    slug: 'updates',
    title: 'Updates',
    description: 'A desktop app that updates itself: the key pair, the signed update the build writes, and the page code that checks for one and installs it.',
    lede: 'A desktop app can update itself from the address in `app.updater`, with updates signed by a key only you hold. The build writes each update beside the app, and your page decides when to install one. iOS and Android apps update through their stores, and a Windows app installed from its MSIX package through Windows: `updater.check()` rejects there.',
    blocks: [
        { type: 'h2', id: 'key', text: 'The key' },
        {
            type: 'p',
            text: '`crossbind app updater-key` makes the key pair. The public key goes in `app.updater.publicKey`, beside the address of the update\'s manifest:',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    target: { runtimeEnv: 'app' },
    app: {
        updater: {
            url: 'https://example.com/updates/my-app-{platform}-{arch}.update.json',
            publicKey: '<what crossbind app updater-key prints>',
        },
    },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: 'The private key goes in `CROSSBIND_UPDATER_PRIVATE_KEY` where the app is built, and nowhere else: whoever has it can sign an update the app installs.',
        },

        { type: 'h2', id: 'build', text: 'What the build writes' },
        {
            type: 'p',
            text: "With the private key, `crossbind app build` writes each desktop app's update beside the app, signed with Ed25519:",
        },
        {
            type: 'ul',
            items: [
                "`dist/<name>-<platform>-<arch>.update.json`, the manifest: `package.json`'s version, the update's file and its signature.",
                "The update file: on macOS `dist/<name>-darwin-<arch>.app.zip`, the signed and notarized app; on Linux the `.tar.gz` of the `tar-gz` installer; on Windows the setup program of the `nsis` installer. So `app.installers` has to keep those two.",
            ],
        },
        {
            type: 'p',
            text: 'Upload both where `app.updater.url` points, the file beside the manifest; `{platform}` is `darwin`, `linux` or `win32`, and `{arch}` is `x64` or `arm64`. A GitHub release works as it is: [GitHub Releases](/guide/github-releases/#updates) uploads them and gives the address.',
        },

        { type: 'h2', id: 'page', text: 'Checking from the page' },
        {
            type: 'p',
            text: 'The page checks for an update and installs it when it decides to, such as after its user agrees; the app never asks on its own:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { updater } from 'crossbind/app';

const update = await updater.check();
if (update && confirm(\`Install \${update.version}?\`)) await updater.install();`,
        },
        {
            type: 'ul',
            items: [
                "`updater.check()` resolves to `{ version }` when the manifest's version is newer than the app's (by semver), else `null`.",
                "`updater.install()` downloads the file and installs it only if the signature covers the app's id, platform, architecture, version and the file's SHA-512. The app then quits and opens the new version, so save what you need first; the promise rejects if installing fails.",
                'One check or install runs at a time; another rejects meanwhile. A manifest over 64 KiB or a file over 2 GiB fails.',
                'In development, `check()` works but `install()` replaces nothing.',
            ],
        },
        {
            type: 'p',
            text: "The app's C++ calls the same by name, with `invoke(\"updater.check\", …)` from `<crossbind/extension.h>`.",
        },

        { type: 'h2', id: 'install', text: 'How it installs' },
        {
            type: 'ul',
            items: [
                "**macOS:** the bundle in the zip takes the app's place, and opens.",
                "**Linux:** the folder in the archive takes the app's place, and its executable opens.",
                "**Windows:** the setup program waits up to 30 seconds for the app to quit, installs the update and opens it; if the app does not quit, it opens the old one again.",
            ],
        },
        {
            type: 'p',
            text: 'On macOS and Linux the swap happens in one step, which local file systems such as APFS and ext4 support; on a network share the update fails and the app stays as it is. An app updates only where its user can change it: a macOS app run from its disk image or download folder updates once moved to Applications, and a Linux app installed from its Debian package updates through the package manager.',
        },

        { type: 'h2', id: 'signer', text: 'Who an update comes from' },
        {
            type: 'p',
            text: 'An app signed for its platform accepts updates only from its own signer, so the updater key alone cannot install anything else:',
        },
        {
            type: 'ul',
            items: [
                "**macOS:** the bundle in the zip must meet the requirement the app's own signature states; for a Developer ID, that names its identifier and team.",
                "**Windows:** the setup program must carry an Authenticode signature Windows trusts, whose certificate has the same common name as the app's. A common name is only a name: any authority Windows trusts may certify it for whoever it finds holds it, and Windows checks no revocation for it.",
            ],
        },
        {
            type: 'p',
            text: 'A renewed certificate keeps the team and the common name, so its updates install. An app signed ad hoc or not at all, and a Linux app, accept any update the key signed. A Windows app signed with a certificate Windows does not trust, such as a self-signed one, installs no update and says why.',
        },

        { type: 'h2', id: 'checks', text: 'What the build checks' },
        {
            type: 'p',
            text: '`crossbind app build` stops before compiling unless `app.updater.url` is https (or http on localhost) and names a manifest, the public key is a valid one, the `package.json` version is semver, and the private key is the public key\'s pair.',
        },
        {
            type: 'p',
            text: `The [updater](${EXTENSIONS_URL}updater/) extension does all of this; a desktop app has it only with \`app.updater\`. Full reference: [app.md](${REFERENCE}#updates).`,
        },
    ],
};
