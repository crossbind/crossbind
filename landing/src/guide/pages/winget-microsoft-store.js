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
    description: 'List a Windows app in winget from its GitHub releases, and in the Microsoft Store as its MSIX packages, which crossbind app upload sends.',
    lede: "winget takes the Windows setup from the [GitHub release](/guide/github-releases/) that `crossbind app upload github` makes: a workflow sends each release to winget's community repository as a pull request. The Microsoft Store takes the app's MSIX packages, built with the identity Partner Center gives the app; `crossbind app upload microsoft-store` sends each version after the first, with the listing.",
    blocks: [
        { type: 'h2', id: 'winget', text: 'winget' },
        {
            type: 'p',
            text: 'winget installs apps from its community repository, `microsoft/winget-pkgs`, which takes each version as a pull request its moderators check. [WinGet Releaser](https://github.com/vedantmgoyal9/winget-releaser) opens that pull request for each release:',
        },
        { type: 'code', file: '.github/workflows/winget.yml', code: WINGET },
        {
            type: 'p',
            text: "Once per app, submit the first version to `microsoft/winget-pkgs` yourself, for example with [Komac](https://github.com/russellbanks/Komac)'s `komac new`: the action makes each new version from the last one there. Fork `microsoft/winget-pkgs` under the account of the app's repository (or name another with the action's `fork-user`), and keep a classic token with the `public_repo` and `workflow` scopes in the `WINGET_TOKEN` secret, since a workflow's own token cannot open a pull request in another repository.",
        },
        {
            type: 'p',
            text: "The setup installs the app for the current user, as winget's `--scope user` does, and `/S` installs it without a window. `types: [released]` waits for a published release: a draft or a prerelease sends nothing.",
        },
        {
            type: 'callout',
            tone: 'warn',
            title: "A workflow's release starts no other workflow",
            text: "A release published with a workflow's own `GITHUB_TOKEN` starts no other workflow. Then run the action as a job after the one that publishes, with `release-tag: v<version>`. A release published by hand, or with another token, starts the workflow above.",
        },

        { type: 'h2', id: 'microsoft-store', text: 'Microsoft Store' },
        {
            type: 'p',
            text: "The Microsoft Store takes a Windows app as its MSIX package ([Installers](/guide/installers/)), which it signs, hosts and updates. Reserve the app's name in Partner Center as an \"MSIX or PWA app\", and copy the identity its Product identity page shows into `crossbind.config.js`:",
        },
        { type: 'code', file: 'crossbind.config.js', code: STORE_IDENTITY },
        {
            type: 'p',
            text: "`crossbind app build -p windows` then writes `dist/<name>-win32-x64.msix` and `dist/<name>-win32-arm64.msix`, unsigned. Partner Center's API cannot make an app's first submission, which takes the age ratings questionnaire: make it there, with these packages and the listing in `store/microsoft-store`, and say why the app asks for `runFullTrust`, as every packaged Win32 app does (it runs as it does outside a package). `crossbind app store microsoft-store` lists each step, with the field and the file it comes from.",
        },
        { type: 'code', file: 'shell', code: 'npx crossbind app store microsoft-store\nnpx crossbind app upload microsoft-store --rollout 10' },
        {
            type: 'p',
            text: "Later versions go with `crossbind app upload microsoft-store`: it builds the MSIX packages, makes a submission with them and the listing, and commits it for certification, which takes up to three business days. `--draft` leaves the submission for you to submit in Partner Center, and `--rollout` gives the packages to a share of the app's users first. `crossbind app store microsoft-store --send` sends the listing alone, with no build, in a submission of the packages Partner Center has.",
        },
        {
            type: 'p',
            text: 'Partner Center\'s API takes an Entra ID application with the Manager role (Account settings › User management › Microsoft Entra applications), named by `CROSSBIND_MICROSOFT_STORE_TENANT_ID`, `CROSSBIND_MICROSOFT_STORE_CLIENT_ID` and `CROSSBIND_MICROSOFT_STORE_CLIENT_SECRET`; an upload in a terminal asks for them once.',
        },
        {
            type: 'p',
            text: "The Store updates the apps it installs, and the app's own [updater](/guide/updates/) refuses there. A packaged app uses the WebView2 Runtime that Windows 11 includes and Windows 10 gets with Edge's updates. Submit the MSIX packages, not the setup program: the Store's policy 10.2.9 refuses an installer that downloads what the app needs, as the setup does for WebView2.",
        },
        { type: 'p', text: `Full reference: [app.md](${REFERENCE}#winget).` },
    ],
};
