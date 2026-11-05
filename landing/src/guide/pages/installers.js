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
    lede: '`crossbind app build` writes what installs a desktop app beside the app: a disk image on macOS, a Debian package and a tar.gz on Linux, a setup program and a zip on Windows. Keys in the environment sign a macOS or Windows app; without them the app still builds, and the build says what its users will see.',
    blocks: [
        { type: 'h2', id: 'formats', text: 'What each platform gets' },
        {
            type: 'table',
            head: ['Installer', 'What it writes'],
            rows: [
                ['`dmg`', '`dist/<name>.dmg`, a disk image that holds the app beside a link to Applications, onto which its user drags it.'],
                ['`deb`', '`dist/<name>-linux-<arch>.deb`, a Debian package that puts the app in `/usr/lib/<package>`, its command in `/usr/bin` and its entry and icon in the menu.'],
                ['`tar-gz`', "`dist/<name>-linux-<arch>.tar.gz`, the app's folder, which unpacks anywhere its user can write."],
                ['`nsis`', "`dist/<name>-win32-<arch>-setup.exe`, a setup program that installs the app for the user who runs it, with no administrator's approval, in `%LOCALAPPDATA%\\Programs\\<app name>`."],
                ['`zip`', "`dist/<name>-win32-<arch>.zip`, the app's folder, as signed."],
            ],
        },
        {
            type: 'ul',
            items: [
                "**The Debian package** depends on WebKitGTK 4.1, release 2.40 or later, GTK 3 and the packages its extensions' `linux.depends` name, which `apt install ./<name>-linux-<arch>.deb` installs with it. It is named after `general.name`, in lower case with a hyphen for each underscore, and takes its maintainer and description from `package.json`'s `author` and `description`. Nothing signs it: apt checks the signature of a repository, not of a package.",
                "**The setup program** adds the app to the Start menu and to the apps list in Settings, whose Uninstall removes it and leaves its data. Where the WebView2 Runtime is missing, it downloads Microsoft's bootstrapper and runs it once it carries a valid signature of Microsoft's. While the app runs, an update or an uninstall asks to close it and changes nothing. `/S` installs without a window.",
                "**The tar.gz and the zip** register neither the app's link schemes nor a menu entry.",
            ],
        },
        {
            type: 'p',
            text: "The package, the shortcut and the folder take their names from the app's, so a `general.name` that makes no Debian name, or an app name with any of `< > : / | ? *` or a space or dot at its end, stops `crossbind app build` before anything compiles.",
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
            text: "That ships a disk image and a Debian package alone, and a name that is no installer stops the build. With `app.updater` the list has to keep `tar-gz` for Linux and `nsis` for Windows, which carry the app's [updates](/guide/updates/). Each installer is an [extension](/guide/extensions/): one of your own adds another format, such as an AppImage, and one listed under a name of crossbind's takes its place.",
        },

        { type: 'h2', id: 'macos', text: 'Signing a macOS app' },
        {
            type: 'p',
            text: 'Without a key, the build signs a macOS app ad hoc, which opens it on the Mac that built it alone, and says so. With a Developer ID it signs the app and its framework with that identity instead, in the hardened runtime. With an App Store Connect API key as well, Apple notarizes the app, and the build staples the ticket to it before it makes the disk image: the app then opens on any Mac, offline too. The disk image stays unsigned, so Gatekeeper judges the notarized app inside it.',
        },
        {
            type: 'table',
            head: ['Variable', 'Value'],
            rows: [
                ['`CROSSBIND_APPLE_SIGNING_IDENTITY`', 'A code signing identity in the keychain, by name or hash, such as `Developer ID Application: <name> (<team>)`.'],
                ['`CROSSBIND_APPLE_API_KEY`', "The API key's `.p8` file, which App Store Connect gives once, or its text, as a CI secret holds it."],
                ['`CROSSBIND_APPLE_API_KEY_ID`', "The key's ID. A file that keeps the name App Store Connect gives it, `AuthKey_<key id>.p8`, tells it already."],
                ['`CROSSBIND_APPLE_API_ISSUER`', "The issuer ID of the key's team."],
            ],
        },
        {
            type: 'p',
            text: "The key alone signs nothing, as it serves [App Store](/guide/app-store/) uploads too: without an identity the app is signed ad hoc. An identity the keychain does not hold, or a name two of its identities share, as after a renewal, stops `crossbind app build` before anything compiles, and so does a key beside the identity that lacks one of its variables or comes with an identity other than a Developer ID Application one.",
        },
        {
            type: 'p',
            text: "Apple takes a few minutes to check the app, and the build gives up after two hours; a rejection stops it with Apple's log. A signed app that is not notarized opens on another Mac only once its user allows it in System Settings, and the build says so.",
        },

        { type: 'h2', id: 'windows', text: 'Signing a Windows app' },
        {
            type: 'p',
            text: "Without a key, a Windows app and its setup program stay unsigned, so SmartScreen warns about them once they are downloaded, and the build says so. With a key in the environment, jsign in crossbind's windows image signs the app before its zip is made, then the setup program and its uninstaller, with Authenticode and a timestamp.",
        },
        {
            type: 'p',
            text: 'The key is one jsign takes: a cloud key service whose credentials jsign takes as its password, such as Azure Trusted Signing, Azure Key Vault, AWS or Google Cloud KMS, or SSL.com eSigner, or a PKCS#12 file. Its files reach the container read-only, and its passwords by name, never on a command line:',
        },
        {
            type: 'table',
            head: ['Variable', 'Value'],
            rows: [
                ['`CROSSBIND_WINDOWS_SIGNING_STORETYPE`', "jsign's store type, such as `TRUSTEDSIGNING`, `AZUREKEYVAULT`, `AWS`, `GOOGLECLOUD`, `ESIGNER` or `PKCS12`."],
                ['`CROSSBIND_WINDOWS_SIGNING_KEYSTORE`', "The key store: the service's endpoint or name, or the PKCS#12 file."],
                ['`CROSSBIND_WINDOWS_SIGNING_ALIAS`', "The key's name in it."],
                ['`CROSSBIND_WINDOWS_SIGNING_STOREPASS`', "Its password, or the service's access token."],
                ['`CROSSBIND_WINDOWS_SIGNING_KEYPASS`', "The key's password, where it is not the store's."],
                ['`CROSSBIND_WINDOWS_SIGNING_CERTFILE`', 'The certificate chain a cloud key comes without, as a `.p7b` file.'],
                ['`CROSSBIND_WINDOWS_SIGNING_TSAURL`', 'The timestamp server; `http://timestamp.digicert.com` without it.'],
            ],
        },
        { type: 'p', text: 'With Azure Trusted Signing, for one:' },
        { type: 'code', file: 'shell', code: AZURE_SIGNING },
        {
            type: 'p',
            text: "A variable without the store type, a store type jsign does not take, a key file that is not there, or a hardware token, which the container does not reach, stops `crossbind app build` before anything compiles. SmartScreen trusts a signed app as its certificate's downloads build a reputation, so the first downloads of a new certificate may still warn.",
        },
        { type: 'p', text: `[app.md](${REFERENCE}#installers) is the reference behind this page.` },
    ],
};
