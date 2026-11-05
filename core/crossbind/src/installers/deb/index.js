import fs from 'node:fs';
import path from 'node:path';

const DEBIAN_ARCH = { x64: 'amd64', arm64: 'arm64' };
// What a Linux app runs on: WebKitGTK 4.1 from its 2.40 release, and the GTK its window is.
const DEBIAN_DEPENDS = 'libwebkit2gtk-4.1-0 (>= 2.40), libgtk-3-0';

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

// crossbind's installer of a Linux app: a Debian package, which dpkg-deb builds in the linux image, with the app in
// /usr/lib/<name>, its command in /usr/bin, and the desktop entry and icon a menu shows it by. The package's name stops
// a build that could not make it before anything compiles.
export default function deb() {
    return {
        name: 'deb',
        root: import.meta.dirname,
        installer: {
            platform: 'linux',
            check(api) {
                debianName(api.project.name);
            },
            make(api, { app, arch }) {
                const name = debianName(api.project.name);
                const label = api.app.name;
                const root = path.join(api.workDir, path.basename(app));
                const dir = (relative) => {
                    fs.mkdirSync(`${root}/${relative}`, { recursive: true });
                    return `${root}/${relative}`;
                };
                fs.rmSync(root, { recursive: true, force: true });
                // What it packages is gone once the package is made, or could not be.
                try {
                    fs.cpSync(app, `${dir('usr/lib')}/${name}`, { recursive: true, verbatimSymlinks: true });
                    fs.symlinkSync(`../lib/${name}/${api.project.name}`, `${dir('usr/bin')}/${name}`);
                    const icon = `${app}/resources/icon.png`;
                    const hasIcon = fs.existsSync(icon);
                    if (hasIcon) fs.copyFileSync(icon, `${dir('usr/share/icons/hicolor/512x512/apps')}/${name}.png`);
                    fs.writeFileSync(`${dir('usr/share/applications')}/${name}.desktop`, desktopEntry({
                        label, command: name, hasIcon, urlSchemes: api.app.urlSchemes, categories: api.app.category?.linux,
                    }));
                    const { author, description } = api.project.package ?? {};
                    fs.writeFileSync(`${dir('DEBIAN')}/control`, debianControl({ name, version: api.app.version, arch, author, description, label }));
                    api.run(['dpkg-deb', '--build', '--root-owner-group', root, `${app}.deb`], { cwd: path.dirname(app) });
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
                return [`${app}.deb`];
            },
        },
    };
}
