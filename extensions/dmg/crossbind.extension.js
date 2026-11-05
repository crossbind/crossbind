import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// crossbind's installer of a macOS app: a disk image that holds the app beside a link to /Applications, onto which its
// user drags it. hdiutil copies a link inside the folder it is given as a link, where it would copy all of
// /Applications for the link itself. The image is not signed: Gatekeeper would then judge it as well, where the app in
// it is what Apple notarizes.
export default function dmg() {
    return {
        name: 'dmg',
        contract: 1,
        root: import.meta.dirname,
        installer: {
            platform: 'macos',
            make(api, { app }) {
                const image = app.replace(/\.app$/, '.dmg');
                const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-dmg-'));
                try {
                    // The image's root takes the folder's permissions, which mkdtemp keeps to its owner.
                    fs.chmodSync(folder, 0o755);
                    fs.cpSync(app, path.join(folder, path.basename(app)), { recursive: true, verbatimSymlinks: true });
                    fs.symlinkSync('/Applications', path.join(folder, 'Applications'));
                    fs.rmSync(image, { force: true });
                    api.run(['hdiutil', 'create', '-quiet', '-volname', api.app.name, '-srcfolder', folder, '-fs', 'HFS+', '-format', 'UDZO', image], { cwd: path.dirname(app) });
                } finally {
                    fs.rmSync(folder, { recursive: true, force: true });
                }
                return [image];
            },
        },
    };
}
