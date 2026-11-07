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

const MICROSOFT_STORE = `name: Publish to the Microsoft Store
on:
  release:
    types: [released]
jobs:
  store:
    runs-on: windows-latest
    steps:
      - uses: microsoft/microsoft-store-apppublisher@v1.4
      - run: msstore reconfigure --tenantId \${{ secrets.PARTNER_CENTER_TENANT_ID }} --sellerId \${{ secrets.PARTNER_CENTER_SELLER_ID }} --clientId \${{ secrets.PARTNER_CENTER_CLIENT_ID }} --clientSecret \${{ secrets.PARTNER_CENTER_CLIENT_SECRET }}
      - shell: bash
        env:
          RELEASE: https://github.com/\${{ github.repository }}/releases/download/\${{ github.event.release.tag_name }}
        run: |
          packages=$(jq -nc --arg release "$RELEASE" '{packages: [["x64", "X64"], ["arm64", "Arm64"]] | map({
            packageUrl: "\\($release)/<name>-win32-\\(.[0])-setup.exe", architectures: [.[1]],
            languages: ["en-us"], isSilentInstall: false, installerParameters: "/S", packageType: "exe"})}')
          msstore submission update \${{ vars.PARTNER_CENTER_PRODUCT_ID }} "$packages"
      - run: msstore submission publish \${{ vars.PARTNER_CENTER_PRODUCT_ID }}`;

export default {
    slug: 'winget-microsoft-store',
    title: 'winget and Microsoft Store',
    description: 'List a Windows app in winget and the Microsoft Store from its GitHub releases, with one workflow each.',
    lede: "Neither takes an upload from crossbind: both take the Windows setup from the [GitHub release](/guide/github-releases/) that `crossbind app publish github` puts out. A workflow that runs on each release hands it on, as a pull request to winget's community repository and as a submission to Partner Center.",
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
            text: "The Store refuses this setup program today. Its policy 10.2.9 takes no installer that downloads what the app needs as it runs, and the setup downloads Microsoft's WebView2 bootstrapper on a system without the runtime ([Installers](/guide/installers/)). So the workflow below does not pass certification yet.",
        },
        {
            type: 'p',
            text: "The Microsoft Store takes a Windows app as the setup program `crossbind app build` makes, which it downloads from the address its submission gives each time it installs the app: a GitHub release's, which keeps each version's file. Microsoft's [Store Developer CLI](https://github.com/microsoft/msstore-cli), `msstore`, points the app's submission at each release and sends it for certification:",
        },
        { type: 'code', file: '.github/workflows/microsoft-store.yml', code: MICROSOFT_STORE },
        {
            type: 'p',
            text: "Once, for the app: create it in Partner Center as an EXE or MSI app, with its name reserved, and complete its first submission there, with its listing, age rating and price, which later ones take as they are. Associate a Microsoft Entra application with the Partner Center account, under Account settings › User management, and keep its tenant, client ID and a client secret, with the account's seller ID, as the workflow's secrets, and the app's product ID, which Partner Center shows under Product identity, as a variable. `isSilentInstall` is false, as the setup installs without a window with `/S` alone.",
        },
        {
            type: 'p',
            text: "The Store installs only a setup signed with a certificate of an authority Microsoft's Trusted Root Program takes, which certification checks ([Signing a Windows app](/guide/installers/#windows)). It fetches the setup from the release each time it installs the app, so leave a release the Store has as it is. It updates no app it installed this way; the app's own [updater](/guide/updates/) does. A release a workflow puts out with its own token starts this workflow as little as winget's.",
        },
        { type: 'p', text: `[app.md](${REFERENCE}#winget) is the reference behind this page.` },
    ],
};
