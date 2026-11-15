import { spawnSync } from 'node:child_process';
import path from 'node:path';

// crossbind's installer of a Linux app as one archive beside its folder, which unpacks anywhere its user can write and
// registers nothing: a Linux app with app.updater updates itself from it. macOS's tar adds no AppleDouble files of
// extended attributes with COPYFILE_DISABLE, and no pax headers of them with --no-xattrs, which GNU tar warns about on
// every file it unpacks.
export default function tarGz() {
    return {
        name: 'tar-gz',
        contract: 1,
        root: import.meta.dirname,
        installer: {
            platform: 'linux',
            make(api, { app }) {
                const archive = `${app}.tar.gz`;
                const result = spawnSync('tar', ['--no-xattrs', '-czf', archive, '-C', path.dirname(app), path.basename(app)], {
                    encoding: 'utf8',
                    env: { ...process.env, COPYFILE_DISABLE: '1' },
                });
                if (result.status !== 0) throw new Error(`crossbind: cannot archive ${app}: ${result.stderr || result.error?.message}`);
                return [archive];
            },
        },
    };
}
