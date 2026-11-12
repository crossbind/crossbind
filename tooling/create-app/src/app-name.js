import fsp from 'node:fs/promises';
import path from 'node:path';

// The name a scaffolded app shows and takes its id from: its project folder's own, as an extension takes its name.
export function appName(project) {
    return path.basename(path.resolve(project));
}

// A string of the config, single-quoted as the template writes its own.
const quoted = (text) => `'${text.replace(/[\\']/g, '\\$&')}'`;

// A desktop app shows general.name and crossbind makes its id from it; its README names the app's files after it.
export async function nameDesktopApp(dir, name) {
    const configPath = path.join(dir, 'crossbind.config.js');
    const config = await fsp.readFile(configPath, 'utf8');
    const templateName = config.match(/general:\s*\{\s*name:\s*'([^']*)'/)[1];
    await fsp.writeFile(configPath, config.replace(`name: '${templateName}'`, () => `name: ${quoted(name)}`));
    const readmePath = path.join(dir, 'README.md');
    await fsp.writeFile(readmePath, (await fsp.readFile(readmePath, 'utf8')).replaceAll(templateName, () => name));
}

// An Electron app shows electron-builder's productName on its file and its menus, and its page's title on its window.
export async function nameElectronApp(dir, name) {
    const builderPath = path.join(dir, 'electron-builder.yml');
    const builder = await fsp.readFile(builderPath, 'utf8');
    await fsp.writeFile(builderPath, builder.replace(/^productName: .*$/m, () => `productName: ${JSON.stringify(name)}`));
    const pagePath = path.join(dir, 'src', 'index.html');
    const title = name.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    await fsp.writeFile(pagePath, (await fsp.readFile(pagePath, 'utf8')).replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`));
}

// The part of an Expo app's id its name makes, which its URL scheme is too: lowercase letters and digits from a letter,
// as an iOS bundle id, an Android package and a scheme all take them.
function idPart(name) {
    const part = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return /^[a-z]/.test(part) ? part : `app${part}`;
}

// An Expo app shows expo.name and has one id on iOS and Android, which its Maestro flow opens it by.
export async function nameExpoApp(dir, name) {
    const appJsonPath = path.join(dir, 'app.json');
    const { expo, ...rest } = JSON.parse(await fsp.readFile(appJsonPath, 'utf8'));
    const part = idPart(name);
    const id = `dev.crossbind.${part}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || part;
    const named = {
        ...rest,
        expo: {
            ...expo,
            name,
            slug,
            scheme: part,
            ios: { ...expo.ios, bundleIdentifier: id },
            android: { ...expo.android, package: id },
        },
    };
    await fsp.writeFile(appJsonPath, `${JSON.stringify(named, null, 2)}\n`);
    const flowPath = path.join(dir, 'maestro.yaml');
    const flow = await fsp.readFile(flowPath, 'utf8');
    await fsp.writeFile(flowPath, flow.replace(`appId: ${expo.ios.bundleIdentifier}`, () => `appId: ${id}`));
}
