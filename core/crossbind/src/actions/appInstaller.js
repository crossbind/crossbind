import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import run from './run.js';
import { appleSigning } from './appleSigning.js';
import { updaterSigning } from './appUpdate.js';
import { inWindowsImage, jsignScript, windowsSigning } from './windowsSigning.js';
import state from '../state/index.js';
import { appCategory, appDisplayName, appId, appUrlSchemes } from '../utils/appOptions.js';
import { readAppIcon, windowsIcon } from '../utils/appIcon.js';
import { imageRoleFor } from '../utils/pullDockerImage.js';
import { isUnderBase } from '../utils/replaceBasePathForDocker.js';
import resolveAppHostRoot from '../utils/resolveAppHost.js';

const DEBIAN_ARCH = { x64: 'amd64', arm64: 'arm64' };
// What a Linux app runs on: WebKitGTK 4.1 from its 2.40 release, and the GTK its window is.
const DEBIAN_DEPENDS = 'libwebkit2gtk-4.1-0 (>= 2.40), libgtk-3-0';

const packageVersion = () => state.config.package?.version ?? '1.0.0';

// The container that packages a Linux or Windows app sees the project's base alone.
export function assertUnderBase(app, target) {
    if (isUnderBase(app, state.config.paths.base)) return;
    const kind = target.platform === 'win32' ? 'Windows' : 'Linux';
    throw new Error(`crossbind: the ${kind} app ${app} is outside ${state.config.paths.base}, the project's base and all the ${imageRoleFor(target)} container sees. Build the app into a directory under it.`);
}

// A Debian package's name: the project's, in lower case, with a hyphen for each underscore and from its first letter
// or digit.
export function debianName(name) {
    const debian = name.toLowerCase().replaceAll('_', '-').replace(/^[^a-z0-9]+/, '');
    if (!/^[a-z0-9][a-z0-9+.-]+$/.test(debian)) {
        throw new Error(`crossbind: general.name ${JSON.stringify(name)} makes no Debian package name, which is two or more lowercase letters, digits, +, . and -, starting with a letter or digit. Change general.name in crossbind.config.js.`);
    }
    return debian;
}

// A Debian version sorts the pre-releases of a release before it, as semver does: 1.0.0-beta.1 is 1.0.0~beta.1.
export const debianVersion = (version) => version.replace('-', '~');

// package.json's author as Debian names a maintainer, by name and email address.
export function maintainer(author) {
    if (typeof author === 'string') return author.replace(/\(.*\)/, '').trim() || null;
    if (!author?.name) return null;
    return author.email ? `${author.name} <${author.email}>` : author.name;
}

// The control file of a Linux app's package. dpkg warns of a package without a maintainer in every command it runs
// afterwards, so without package.json's author the app's name stands for one.
export function debianControl({ name, version, arch, author, description, label }) {
    return [
        `Package: ${name}`,
        `Version: ${debianVersion(version)}`,
        `Architecture: ${DEBIAN_ARCH[arch]}`,
        `Maintainer: ${maintainer(author) ?? label}`,
        `Depends: ${DEBIAN_DEPENDS}`,
        `Description: ${(description || label).replace(/\s+/g, ' ').trim()}`,
        '',
    ].join('\n');
}

// The desktop entry a Linux menu shows an app by. GTK names the app's window after the command that started it, and
// GNOME on Wayland shows the icon of the entry whose file has that name.
// A link of one of its schemes opens it with the link as its argument, %u. A menu shows it under its categories.
export function desktopEntry({ label, command, hasIcon, urlSchemes = [], categories = null }) {
    const isLinked = urlSchemes.length > 0;
    return [
        '[Desktop Entry]', 'Type=Application', `Name=${label}`, `Exec=${command}${isLinked ? ' %u' : ''}`, ...(hasIcon ? [`Icon=${command}`] : []),
        ...(isLinked ? [`MimeType=${urlSchemes.map((scheme) => `x-scheme-handler/${scheme};`).join('')}`] : []),
        ...(categories ? [`Categories=${categories};`] : []), 'Terminal=false', '',
    ].join('\n');
}

// A disk image of a macOS app beside a link to /Applications, onto which its user drags it. hdiutil copies a link
// inside the folder it is given as a link, where it would copy all of /Applications for the link itself. The image is
// not signed: Gatekeeper would then judge it as well, where the app in it is what Apple notarizes.
function diskImage(app, target) {
    const image = app.replace(/\.app$/, '.dmg');
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-dmg-'));
    try {
        // The image's root takes the folder's permissions, which mkdtemp keeps to its owner.
        fs.chmodSync(folder, 0o755);
        fs.cpSync(app, path.join(folder, path.basename(app)), { recursive: true, verbatimSymlinks: true });
        fs.symlinkSync('/Applications', path.join(folder, 'Applications'));
        fs.rmSync(image, { force: true });
        run(null, ['hdiutil', 'create', '-quiet', '-volname', appDisplayName(state.config), '-srcfolder', folder, '-fs', 'HFS+', '-format', 'UDZO', image], null, target);
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
}

// A Debian package of a Linux app, which dpkg-deb builds in the linux image: the app in /usr/lib/<name>, its command
// in /usr/bin, and the desktop entry and icon a menu shows it by.
function debianPackage(app, target) {
    assertUnderBase(app, target);
    const { general, paths } = state.config;
    const name = debianName(general.name);
    const label = appDisplayName(state.config);
    const root = `${paths.build}/${path.basename(app)}.deb`;
    const dir = (relative) => {
        fs.mkdirSync(`${root}/${relative}`, { recursive: true });
        return `${root}/${relative}`;
    };
    fs.rmSync(root, { recursive: true, force: true });
    fs.cpSync(app, `${dir('usr/lib')}/${name}`, { recursive: true, verbatimSymlinks: true });
    fs.symlinkSync(`../lib/${name}/${general.name}`, `${dir('usr/bin')}/${name}`);
    const icon = `${app}/resources/icon.png`;
    const hasIcon = fs.existsSync(icon);
    if (hasIcon) fs.copyFileSync(icon, `${dir('usr/share/icons/hicolor/512x512/apps')}/${name}.png`);
    fs.writeFileSync(`${dir('usr/share/applications')}/${name}.desktop`, desktopEntry({
        label, command: name, hasIcon, urlSchemes: appUrlSchemes(state.config), categories: appCategory(state.config)?.linux,
    }));
    const { author, description } = state.config.package ?? {};
    fs.writeFileSync(`${dir('DEBIAN')}/control`, debianControl({ name, version: packageVersion(), arch: target.arch, author, description, label }));
    run(null, ['dpkg-deb', '--build', '--root-owner-group', root, `${app}.deb`], null, target);
    fs.rmSync(root, { recursive: true, force: true });
}

// The name a Windows app's setup program gives its Start menu shortcut and folder, which Windows takes as a file name.
function windowsName() {
    const label = appDisplayName(state.config);
    if (/[<>:/|?*]|[ .]$/.test(label)) {
        throw new Error(`crossbind: ${JSON.stringify(label)}, the name of a Windows app's Start menu shortcut and folder, is no file name Windows takes, which holds none of < > : / | ? * and ends in neither a space nor a dot. Change app.name in crossbind.config.js.`);
    }
    return label;
}

// A Windows setup program reads a dollar sign in its text as the start of a variable.
const nsisText = (text) => text.replaceAll('$', () => '$$');

// The schemes a Windows app's setup program registers, as a macro that calls the one it is given on each.
const schemesMacro = (schemes) => ['!macro CROSSBIND_URL_SCHEMES DO', ...schemes.map((scheme) => `  !insertmacro \${DO} "${scheme}"`), '!macroend', ''].join('\n');

// A Windows app's setup program, which NSIS builds in the windows image from the host's installer.nsi; with a key in
// the environment, jsign signs it and its uninstaller as NSIS writes them.
function windowsSetup(app) {
    const signing = windowsSigning();
    const icon = readAppIcon(state.config);
    const iconFile = `${state.config.paths.build}/${path.basename(app)}.ico`;
    if (icon) fs.writeFileSync(iconFile, windowsIcon(icon));
    const urlSchemes = appUrlSchemes(state.config);
    const schemesFile = `${state.config.paths.build}/${path.basename(app)}.schemes.nsh`;
    if (urlSchemes.length > 0) fs.writeFileSync(schemesFile, schemesMacro(urlSchemes));
    inWindowsImage([
        'makensis', '-V2', '-INPUTCHARSET', 'UTF8',
        `-DNAME=${nsisText(windowsName())}`,
        `-DEXE=${nsisText(`${state.config.general.name}.exe`)}`,
        `-DID=${appId(state.config)}`,
        `-DVERSION=${nsisText(packageVersion())}`,
        `-DAPP=${app}`,
        `-DOUTFILE=${app}-setup.exe`,
        ...(icon ? [`-DICON=${iconFile}`] : []),
        ...(urlSchemes.length > 0 ? [`-DSCHEMES=${schemesFile}`] : []),
        ...(signing ? [`-DSIGNER=${jsignScript()}`] : []),
        `${resolveAppHostRoot()}/windows/installer.nsi`,
    ], path.dirname(app), signing);
}

// What an app's installer takes from the app and the environment, checked before anything compiles: the names, the keys
// that sign a macOS or Windows app, and the one that signs a desktop app's update.
export function checkInstaller(target) {
    if (target.platform === 'darwin') appleSigning();
    else if (target.platform === 'linux') debianName(state.config.general.name);
    else if (target.platform === 'win32') {
        windowsName();
        windowsSigning();
    }
    if (['darwin', 'linux', 'win32'].includes(target.platform)) updaterSigning();
}

// What installs a desktop app, written beside it: a disk image on macOS, a Debian package on Linux and a setup program
// on Windows.
export default function writeInstaller(app, target) {
    if (target.platform === 'darwin') diskImage(app, target);
    else if (target.platform === 'linux') debianPackage(app, target);
    else if (target.platform === 'win32') windowsSetup(app);
}
