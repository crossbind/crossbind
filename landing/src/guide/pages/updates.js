import { EXTENSIONS_URL, REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;

export default {
    slug: 'updates',
    title: 'Updates',
    description: 'A desktop app that updates itself: the key pair, the signed update the build writes, and the page code that checks for one and installs it.',
    lede: 'A desktop app updates itself from the address `app.updater` names, with updates signed by a key only you hold. The build writes each update beside the app, and the page decides when to install one. iOS and Android apps update through their stores, where `updater.check()` rejects.',
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
                "The file: on macOS `dist/<name>-darwin-<arch>.app.zip`, the app as signed and notarized, zipped with ditto; on Linux the `.tar.gz` of the `tar-gz` installer; on Windows the setup program of the `nsis` installer. A Linux or Windows build whose `app.installers` leaves that installer out stops, naming it.",
            ],
        },
        {
            type: 'p',
            text: 'Both go where `app.updater.url` points, the file beside the manifest, with `{platform}` as `darwin`, `linux` or `win32` and `{arch}` as `x64` or `arm64`. A GitHub release holds them as they are: [GitHub Releases](/guide/github-releases/#updates) puts them up and gives the address to point at.',
        },

        { type: 'h2', id: 'page', text: 'Checking from the page' },
        {
            type: 'p',
            text: 'The page asks for an update and installs it when it decides to, as once its user agrees; the app asks no one by itself:',
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
                "`updater.check()` gives `{ version }` when the manifest's version is newer than the app's, as semver orders them, and `null` otherwise.",
                "`updater.install()` downloads the file into the app's cache folder and installs it only when the signature covers the app's id, its platform and architecture, its version and its SHA-512. The app then quits and opens the new version, so save what you need first; the promise rejects when installing fails.",
                'One check or install runs at a time, and another rejects meanwhile. A manifest over 64 KiB or a file over 2 GiB fails.',
                'A development session checks, but installs nothing in place of the app its dev server opened.',
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
                "**Windows:** the setup program waits up to 30 seconds for the app to quit, installs the update in the app's folder and opens it, or opens the app as it was once it has waited in vain.",
            ],
        },
        {
            type: 'p',
            text: "On macOS and Linux the app's folder swaps the app for its update in one step, which local file systems such as APFS and ext4 do; on a network share, which cannot, the update fails and leaves the app as it is. An app updates where its user can change it: a macOS app opened from its disk image, or from the folder it was downloaded to, updates once it is moved to Applications, and a Linux app installed from its Debian package updates with the package manager instead.",
        },

        { type: 'h2', id: 'signer', text: 'Who an update comes from' },
        {
            type: 'p',
            text: "An app signed for its platform takes an update from its own signer alone, so the updater's key by itself installs nothing else:",
        },
        {
            type: 'ul',
            items: [
                "**macOS:** as with Sparkle, the bundle in the zip has to meet the requirement the app's own signature states, which for a Developer ID names its identifier and team.",
                "**Windows:** the setup program has to carry an Authenticode signature Windows trusts, whose certificate has the common name of the app's own. That is a name, which any authority Windows trusts may certify for whoever it finds holds it, and Windows checks no revocation for it.",
            ],
        },
        {
            type: 'p',
            text: 'A renewed certificate keeps the team and the common name, so its updates install. An app signed ad hoc or not at all, and a Linux app, which no signature names, take any update the key signed. A Windows app signed with a certificate Windows does not trust, such as a self-signed one, installs none and says why.',
        },

        { type: 'h2', id: 'checks', text: 'What the build checks' },
        {
            type: 'p',
            text: "An `app.updater.url` that is neither https nor http on localhost or names no manifest, a public key that is none or one anyone can forge signatures for, a `package.json` version that is not semver, and a private key that is not the public key's pair stop `crossbind app build` before anything compiles.",
        },
        {
            type: 'p',
            text: `The [updater](${EXTENSIONS_URL}updater/) extension does all of this, and a desktop app has it only with \`app.updater\`; it checks signatures with Monocypher, which it compiles in. [app.md](${REFERENCE}#updates) is the reference behind this page.`,
        },
    ],
};
