import { REPO_URL } from '../../data.js';

const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;

const WINGET = `name: Publish to winget
on:
  release:
    types: [released]
jobs:
  winget:
    runs-on: ubuntu-latest
    steps:
      - uses: vedantmgoyal9/winget-releaser@v2
        with:
          identifier: <Publisher>.<App>
          installers-regex: '-win32-(x64|arm64)-setup\\.exe$'
          token: \${{ secrets.WINGET_TOKEN }}`;

const STORE_IDENTITY = `app: {
    icon: 'icon.png',
    windows: {
        msix: { name: '12345Example.Demo', publisher: 'CN=1A2B3C4D-…', publisherDisplayName: 'Example' },
    },
},`;

export default {
    slug: 'winget-microsoft-store',
    title: 'winget and Microsoft Store',
    description: 'List a Windows app in winget from its GitHub releases, and in the Microsoft Store as its MSIX package.',
    lede: "winget takes the Windows setup from the [GitHub release](/guide/github-releases/) that `crossbind app publish github` puts out, which a workflow on each release hands on as a pull request to winget's community repository. The Microsoft Store takes the app's MSIX package, which a Windows build makes with the identity Partner Center gives the app.",
    blocks: [
        { type: 'h2', id: 'winget', text: 'winget' },
        {
            type: 'p',
            text: 'The Windows Package Manager installs an app from its community repository, `microsoft/winget-pkgs`, which takes each version as a pull request its moderators check. [WinGet Releaser](https://github.com/vedantmgoyal9/winget-releaser), which [Komac](https://github.com/russellbanks/Komac) drives, makes that pull request for each release, from the Windows setups it holds:',
        },
        { type: 'code', file: '.github/workflows/winget.yml', code: WINGET },
        {
            type: 'p',
            text: "Once, for the app: submit its first version to `microsoft/winget-pkgs` yourself, as Komac's `komac new` does, since the action makes each new version from the last one there. Fork `microsoft/winget-pkgs` under the account of the app's repository, or name another account with the action's `fork-user`, and keep a classic token with the `public_repo` and `workflow` scopes in the `WINGET_TOKEN` secret, as a workflow's own token opens no pull request in another repository.",
        },
        {
            type: 'p',
            text: "The setup installs the app for its user alone, as winget's `--scope user` does, and `/S` installs it without a window. `types: [released]` waits for a release that is out, as GitHub gives its files to no one before: a draft or a prerelease sends nothing.",
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'A release a workflow puts out starts no other workflow',
            text: 'A release put out with a workflow\'s own `GITHUB_TOKEN` starts no other workflow, as GitHub keeps such events from starting one. There, run the action as a job after the one that puts the release out, with `release-tag: v<version>`; a release put out by hand, or with another token, starts the workflow above.',
        },

        { type: 'h2', id: 'microsoft-store', text: 'Microsoft Store' },
        {
            type: 'p',
            text: "The Microsoft Store takes a Windows app as its MSIX package ([Installers](/guide/installers/)), which it signs, hosts and updates. Reserve the app's name in Partner Center as an \"MSIX or PWA app\", and copy the identity its Product identity page shows into `crossbind.config.js`:",
        },
        { type: 'code', file: 'crossbind.config.js', code: STORE_IDENTITY },
        {
            type: 'p',
            text: "`crossbind app build -p windows` then writes `dist/<name>-win32-x64.msix` and `dist/<name>-win32-arm64.msix`, unsigned, which a submission in Partner Center takes under Packages. Make the first submission there, with the app's listing, age rating and price, which later ones take as they are, and say why the app asks for `runFullTrust`, as every Win32 app in a package does: it runs as the app does outside one. Each later version is above the last one the Store has, as package.json's next release is.",
        },
        {
            type: 'p',
            text: "The Store updates the app it installed, and the app's own [updater](/guide/updates/) refuses there. An app from its package uses the WebView2 Runtime that Windows 11 comes with and Windows 10 has from Edge's updates. The setup program does not pass the Store's certification: its policy 10.2.9 takes no installer that downloads what the app needs as it runs, and the setup downloads Microsoft's WebView2 bootstrapper on a system without the runtime.",
        },
        { type: 'p', text: `[app.md](${REFERENCE}#winget) is the reference behind this page.` },
    ],
};
