import { REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;

const AZURE_SIGNING = `export CROSSBIND_WINDOWS_SIGNING_STORETYPE=TRUSTEDSIGNING
export CROSSBIND_WINDOWS_SIGNING_KEYSTORE=weu.codesigning.azure.net
export CROSSBIND_WINDOWS_SIGNING_ALIAS=<account>/<profile>
export CROSSBIND_WINDOWS_SIGNING_STOREPASS="$(az account get-access-token --resource https://codesigning.azure.net --query accessToken -o tsv)"`;

export default {
    slug: 'installers',
    title: 'Installers and signing',
    description: 'The disk image, Debian package, setup program and archives a desktop app build writes, and the keys that sign a macOS or Windows app.',
    lede: "`crossbind app build` writes a desktop app's installers beside it: a disk image on macOS, a Debian package and a tar.gz on Linux, and a setup program, a zip and, on request, an MSIX package on Windows. Keys in the environment sign macOS and Windows apps; without them the app still builds, and the build warns what its users will see.",
    blocks: [
        { type: 'h2', id: 'formats', text: 'What each platform gets' },
        {
            type: 'entries',
            items: [
                { name: '`dmg`', text: '`dist/<name>.dmg`: a disk image with the app beside a link to Applications, for its user to drag it there.' },
                { name: '`deb`', text: '`dist/<name>-linux-<arch>.deb`: a Debian package that puts the app in `/usr/lib/<package>`, its command in `/usr/bin`, and its entry and icon in the menu.' },
                { name: '`tar-gz`', text: "`dist/<name>-linux-<arch>.tar.gz`: the app's folder, which unpacks anywhere its user can write." },
                { name: '`nsis`', text: "`dist/<name>-win32-<arch>-setup.exe`: a setup program that installs the app for the current user, without administrator rights, in `%LOCALAPPDATA%\\Programs\\<app name>`." },
                { name: '`zip`', text: "`dist/<name>-win32-<arch>.zip`: the app's folder, signed." },
                {
                    name: '`msix`',
                    text: "`dist/<name>-win32-<arch>.msix`: an MSIX package, made only on request. With `app.windows.msix` it carries the identity the [Microsoft Store](/guide/winget-microsoft-store/#microsoft-store) gives the app and stays unsigned, as the Store signs it; with `msix` in `app.installers` it is for handing out, signed with the app's key.",
                },
            ],
        },
        {
            type: 'ul',
            items: [
                "**The Debian package** depends on WebKitGTK 4.1 (2.40 or later), GTK 3 and the packages its extensions name in `linux.depends`; `apt install ./<name>-linux-<arch>.deb` installs them with it. Its name is `general.name` in lower case, with hyphens for underscores, and its maintainer and description come from `package.json`'s `author` and `description`. It is not signed: apt checks repositories, not packages.",
                "**The setup program** adds the app to the Start menu and to the apps list in Settings, whose Uninstall removes the app and keeps its data. Where the WebView2 Runtime is missing, it downloads Microsoft's installer and runs it after checking Microsoft's signature. While the app runs, an update or an uninstall asks to close it first. `/S` installs without a window.",
                "**The tar.gz and the zip** register neither the app's link schemes nor a menu entry.",
            ],
        },
        {
            type: 'p',
            text: "The package, the shortcut and the folder take the app's name, so `crossbind app build` stops before compiling on a `general.name` that makes no Debian name, or on an app name with any of `< > : / | ? *` or a space or dot at its end.",
        },

        { type: 'h2', id: 'choose', text: 'Choosing installers' },
        { type: 'p', text: "A build runs every installer of its platform, unless `app.installers` names the ones to run:" },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    target: { runtimeEnv: 'app' },
    app: {
        installers: ['dmg', 'deb'],
    },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: "That ships only a disk image and a Debian package. With `app.updater`, keep `tar-gz` for Linux and `nsis` for Windows: they carry the app's [updates](/guide/updates/). Each installer is an [extension](/guide/extensions/), so one of your own can add a format such as AppImage.",
        },

        { type: 'h2', id: 'macos', text: 'Signing a macOS app' },
        {
            type: 'p',
            text: 'Without a key, the build signs a macOS app ad hoc, and it opens only on the Mac that built it. With a Developer ID identity, the build signs the app with it, in the hardened runtime. With an App Store Connect API key as well, Apple notarizes the app and the build staples the ticket before making the disk image, so the app opens on any Mac, offline too. The disk image itself stays unsigned.',
        },
        {
            type: 'entries',
            items: [
                { name: '`CROSSBIND_APPLE_SIGNING_IDENTITY`', text: 'A code signing identity in the keychain, by name or hash, such as `Developer ID Application: <name> (<team>)`.' },
                { name: '`CROSSBIND_APPLE_API_KEY`', text: "The API key's `.p8` file, which App Store Connect gives once, or its text, as a CI secret holds it." },
                { name: '`CROSSBIND_APPLE_API_KEY_ID`', text: "The key's ID. Not needed while the file keeps the name App Store Connect gives it, `AuthKey_<key id>.p8`." },
                { name: '`CROSSBIND_APPLE_API_ISSUER`', text: "The issuer ID of the key's team." },
            ],
        },
        {
            type: 'p',
            text: "On your own Mac, `crossbind config set APPLE_API_KEY <its .p8 file>` and `crossbind config set APPLE_API_ISSUER <its issuer ID>` keep the key in `~/.crossbind/config.json`, which takes the file's path and never the key's own text; a variable the environment sets wins over each.",
        },
        {
            type: 'p',
            text: 'The API key alone signs nothing, since it also serves [App Store](/guide/app-store/) uploads: without an identity the app is signed ad hoc. The build stops before compiling when the keychain lacks the identity, or when two of its identities share the name, as after a renewal.',
        },
        {
            type: 'p',
            text: "Notarizing takes a few minutes; the build gives up after two hours, and a rejection stops it with Apple's log. A signed app that is not notarized opens on another Mac only after its user allows it in System Settings.",
        },

        { type: 'h2', id: 'windows', text: 'Signing a Windows app' },
        {
            type: 'p',
            text: 'Without a key, a Windows app and its setup program stay unsigned, so SmartScreen warns about them after a download. With a key in the environment, the build signs the app, the setup program and its uninstaller with Authenticode and a timestamp, using jsign.',
        },
        {
            type: 'p',
            text: 'The key can be any that jsign takes: a cloud key service (Azure Artifact Signing, formerly Trusted Signing; Azure Key Vault; AWS or Google Cloud KMS; SSL.com eSigner) or a PKCS#12 file. Key files reach the container read-only, and passwords never appear on a command line:',
        },
        {
            type: 'entries',
            items: [
                { name: '`CROSSBIND_WINDOWS_SIGNING_STORETYPE`', text: "jsign's store type, such as `TRUSTEDSIGNING`, `AZUREKEYVAULT`, `AWS`, `GOOGLECLOUD`, `ESIGNER` or `PKCS12`." },
                { name: '`CROSSBIND_WINDOWS_SIGNING_KEYSTORE`', text: "The key store: the service's endpoint or name, or the PKCS#12 file." },
                { name: '`CROSSBIND_WINDOWS_SIGNING_ALIAS`', text: "The key's name in it." },
                { name: '`CROSSBIND_WINDOWS_SIGNING_STOREPASS`', text: "Its password, or the service's access token." },
                { name: '`CROSSBIND_WINDOWS_SIGNING_KEYPASS`', text: "The key's password, where it is not the store's." },
                { name: '`CROSSBIND_WINDOWS_SIGNING_CERTFILE`', text: 'The certificate chain, as a `.p7b` file, for a cloud key that comes without one.' },
                { name: '`CROSSBIND_WINDOWS_SIGNING_TSAURL`', text: 'The timestamp server.', default: '`http://timestamp.digicert.com`' },
            ],
        },
        { type: 'p', text: 'With Azure Artifact Signing, for example:' },
        { type: 'code', file: 'shell', code: AZURE_SIGNING },
        {
            type: 'p',
            text: 'A hardware token cannot sign: the container does not reach it. SmartScreen trusts a certificate as its downloads build a reputation, so the first downloads of a new certificate may still warn.',
        },
        { type: 'p', text: `Full reference: [app.md](${REFERENCE}#installers).` },
    ],
};
