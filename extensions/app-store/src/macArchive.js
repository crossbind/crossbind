import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Apple's names of crossbind's architectures.
const ARCHES = { arm64: 'arm64', x64: 'x86_64' };

const escaped = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// A value as an XML plist writes it, indented.
function plistValue(value, indent) {
    if (value instanceof Date) return `${indent}<date>${value.toISOString().replace(/\.\d{3}Z$/, 'Z')}</date>`;
    if (typeof value === 'number') return `${indent}<integer>${value}</integer>`;
    if (Array.isArray(value)) return [`${indent}<array>`, ...value.map((item) => plistValue(item, `${indent}    `)), `${indent}</array>`].join('\n');
    if (typeof value === 'object') {
        return [`${indent}<dict>`, ...Object.entries(value).flatMap(([key, item]) => [`${indent}    <key>${escaped(key)}</key>`, plistValue(item, `${indent}    `)]), `${indent}</dict>`].join('\n');
    }
    return `${indent}<string>${escaped(String(value))}</string>`;
}

const plist = (root) => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    plistValue(root, ''),
    '</plist>',
    '',
].join('\n');

// The archive Xcode exports for App Store Connect, of the app crossbind built and signed ad hoc, as an archive of Xcode's
// own holds one: the app under Products/Applications, its dSYM under dSYMs, and an Info.plist that names it, its version
// and its team. Xcode takes the app's entitlements from its signature.
export function writeArchive(api, { app, arch }, { team }) {
    const name = path.basename(app, '.app');
    const archive = path.join(api.workDir, `${name}.xcarchive`);
    const applications = path.join(archive, 'Products', 'Applications');
    fs.rmSync(archive, { recursive: true, force: true });
    fs.mkdirSync(applications, { recursive: true });
    // ditto keeps the signed bundle as it is: its links, modes and attributes.
    const copied = spawnSync('ditto', [app, path.join(applications, path.basename(app))], { encoding: 'utf8' });
    if (copied.error || copied.status !== 0) {
        throw new Error(`crossbind: ditto could not copy ${app} into the archive: ${(copied.stderr || copied.error?.message || '').trim()}`);
    }
    fs.writeFileSync(path.join(archive, 'Info.plist'), plist({
        ApplicationProperties: {
            ApplicationPath: `Applications/${path.basename(app)}`,
            Architectures: [ARCHES[arch] ?? arch],
            CFBundleIdentifier: api.app.id,
            CFBundleShortVersionString: api.app.appleVersion,
            CFBundleVersion: String(api.app.buildNumber ?? api.app.appleVersion),
            SigningIdentity: '-',
            Team: team,
        },
        ArchiveVersion: 2,
        CreationDate: new Date(),
        Name: name,
        SchemeName: name,
    }));
    // App Store Connect asks for the dSYM of each binary. crossbind builds a macOS app without debug information, so its
    // dSYM holds the symbols the binary keeps, which give crash reports functions without files and lines.
    const binary = path.join(applications, path.basename(app), 'Contents', 'MacOS', name);
    const dsym = spawnSync('dsymutil', [binary, '-o', path.join(archive, 'dSYMs', `${path.basename(app)}.dSYM`)], { encoding: 'utf8' });
    if (dsym.error || dsym.status !== 0) {
        throw new Error(`crossbind: dsymutil could not write the dSYM of ${binary}: ${(dsym.stderr || dsym.error?.message || '').trim()}`);
    }
    return archive;
}
