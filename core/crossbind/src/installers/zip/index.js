import fs from 'node:fs';
import path from 'node:path';

// crossbind's installer of a Windows app as one zip beside its folder, of the app as signed, which the windows image
// makes. It registers nothing.
export default function zip() {
    return {
        name: 'zip',
        root: import.meta.dirname,
        installer: {
            platform: 'windows',
            make(api, { app }) {
                const archive = `${app}.zip`;
                fs.rmSync(archive, { force: true });
                api.run(['zip', '-q', '-r', '-X', path.basename(archive), path.basename(app)], { cwd: path.dirname(app) });
                return [archive];
            },
        },
    };
}
