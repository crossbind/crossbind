import fs from 'node:fs';
import path from 'node:path';
import extensionApi from './extensionApi.js';
import { appleSigning } from './appleSigning.js';
import writeUpdate, { UPDATE_INSTALLERS, updaterSigning } from './appUpdate.js';
import { DESKTOP_PLATFORMS, recordAppOutput } from './buildApp.js';
import { windowsSigning } from './windowsSigning.js';
import state from '../state/index.js';
import { hasTerminal } from '../utils/ask.js';
import { appInstallers, appUpdater } from '../utils/appOptions.js';
import { checkedExtension, withListed } from '../utils/appExtensions.js';
import { configChangesOf } from '../utils/configChanges.js';
import dmg from '../installers/dmg/index.js';
import deb from '../installers/deb/index.js';
import tarGz from '../installers/tar-gz/index.js';
import nsis from '../installers/nsis/index.js';
import zip from '../installers/zip/index.js';

const PLATFORM_NAMES = { linux: 'Linux', win32: 'Windows' };
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

// crossbind's own installers, each an extension as an extension package's crossbind.extension.js gives one.
export const builtInInstallers = () => [dmg, deb, tarGz, nsis, zip].map((extension) => {
    const own = extension();
    return checkedExtension(own, own.root, `crossbind's own extension ${own.name}`);
});

// The installers an app has: crossbind's own, each in the place of the app's extension of its name that has an
// installer, then those of the app's other extensions.
export const installersOf = (extensions) => withListed(builtInInstallers(), extensions.filter((extension) => extension.installer));

// The installers of the target's platform that make what installs its app: every one, or those app.installers names,
// which names none that is no installer.
export function installersFor(target) {
    const all = installersOf(state.config.extensions ?? []);
    const named = appInstallers(state.config);
    const unknown = named?.find((name) => !all.some((extension) => extension.name === name));
    if (unknown) throw new Error(`crossbind: app.installers names ${unknown}, which is no installer: ${listed(all.map(({ name }) => name))} are.`);
    const platform = DESKTOP_PLATFORMS[target.platform];
    return all.filter(({ name, installer }) => installer.platforms.includes(platform) && (!named || named.includes(name)));
}

const apiOf = (name, target) => extensionApi(name, { platform: DESKTOP_PLATFORMS[target.platform], isGuided: hasTerminal(), target });

// What a desktop app ships with stops a build that could not make it here, before anything compiles: the keys that sign
// the app and its update, the installers app.installers names, what each installer checks, and on Linux and Windows
// the installer whose file an app with app.updater updates itself from.
export async function checkInstaller(target) {
    if (!DESKTOP_PLATFORMS[target.platform]) return;
    if (target.platform === 'darwin') appleSigning();
    if (target.platform === 'win32') windowsSigning();
    updaterSigning();
    const installers = installersFor(target);
    for (const { name, installer } of installers) {
        if (installer.check) await installer.check(apiOf(name, target));
    }
    const update = UPDATE_INSTALLERS[target.platform];
    if (update && appUpdater(state.config) && !installers.some(({ name }) => name === update)) {
        const updates = `a ${PLATFORM_NAMES[target.platform]} app with app.updater updates itself from what its ${update} installer makes`;
        // A publisher's build may narrow the installers its store takes.
        if (configChangesOf()?.app?.installers !== undefined) {
            throw new Error(`crossbind: ${updates}, which the publisher's build leaves out of app.installers: its build lists ${update} too, or removes app.updater with { app: { updater: null } }.`);
        }
        throw new Error(`crossbind: ${updates}, which app.installers leaves out: list ${update} in it, or remove app.updater.`);
    }
}

// The files an installer made, by their paths, a relative one beside the app.
function madeFiles(name, app, files) {
    if (!Array.isArray(files) || !files.every((file) => typeof file === 'string')) {
        throw new Error(`crossbind: the installer ${name} made no list of files, which its make returns.`);
    }
    return files.map((file) => {
        const made = path.resolve(path.dirname(app), file);
        if (!fs.statSync(made, { throwIfNoEntry: false })?.isFile()) throw new Error(`crossbind: the installer ${name} made ${made}, which is no file.`);
        return made;
    });
}

// What installs a desktop app, beside it: each installer's, by its name, with the files it made, in the order they run.
export async function writeInstallers(app, target) {
    const made = [];
    for (const { name, installer } of installersFor(target)) {
        const files = await installer.make(apiOf(name, target), Object.freeze({ app, arch: target.arch }));
        made.push({ name, files: madeFiles(name, app, files) });
    }
    return made;
}

// A desktop app with its page ships with what installs it, and with an updater's key with its update too. Installers
// write beside the app, in the page's own folder, so they run once every app of the build has its page.
export async function shipApp(target, to) {
    if (!DESKTOP_PLATFORMS[target.platform]) return;
    const app = path.resolve(to);
    const installers = await writeInstallers(app, target);
    recordAppOutput(target, app, { installers, update: writeUpdate(app, target, installers) });
}
