import {
    afterEach, beforeEach, describe, expect, test,
} from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import {
    archiveLength, archiveStream, isSnapshotPath, webBuildFiles,
} from '../src/utils/snapshotArchive.js';

let dir;
beforeEach(() => {
    dir = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-snapshot-'))));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const build = () => upath.join(dir, 'build');
function write(path, contents) {
    const file = upath.join(build(), path);
    fs.mkdirSync(upath.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
}

describe("a snapshot's archive", () => {
    test('is a ustar archive of the web build that tar reads back file for file, as long as it says, with a long path cut at a slash', async () => {
        // Past a header's 100 characters, in a name of 50 under a folder of 60.
        const long = `assets/${'d'.repeat(60)}/${'f'.repeat(47)}.js`;
        const contents = {
            'index.html': '<!doctype html>', 'assets/app.js': 'x'.repeat(513), 'empty.txt': '', [long]: 'long',
        };
        Object.entries(contents).forEach(([path, text]) => write(path, text));

        const files = webBuildFiles(build());
        const bytes = Buffer.from(await new Response(archiveStream(files)).arrayBuffer());
        fs.writeFileSync(upath.join(dir, 'snapshot.tar'), bytes);
        fs.mkdirSync(upath.join(dir, 'out'));
        const tar = spawnSync('tar', ['-xf', 'snapshot.tar', '-C', 'out'], { cwd: dir, encoding: 'utf8' });

        expect(long.length).toBeGreaterThan(100);
        expect(tar.status, tar.stderr).toBe(0);
        expect(files.map(({ path }) => path)).toEqual(Object.keys(contents).sort());
        expect(bytes.length).toBe(archiveLength(files));
        expect(Object.keys(contents).map((path) => fs.readFileSync(upath.join(dir, 'out', path), 'utf8'))).toEqual(Object.values(contents));
    });

    test('takes plain names between slashes alone, nothing under __crossbind/, and what a header holds', () => {
        const taken = ['index.html', 'assets/index-D6FkeeuK.js', '@scope/a+b_c.js', 'crossbind.data.txt', `${'d'.repeat(155)}/${'f'.repeat(100)}`];
        const refused = ['__crossbind/app.js', 'my page.html', 'ünlü.js', '../up.js', './x.js', 'a/../b.js', 'a//b.js', '/rooted.js', 'f'.repeat(101), `${'d'.repeat(156)}/f.js`];

        expect(taken.map(isSnapshotPath)).toEqual(taken.map(() => true));
        expect(refused.map(isSnapshotPath)).toEqual(refused.map(() => false));
    });

    test('names a file at a path crossbind cloud keeps none at, before anything is sent', () => {
        write('index.html', '<!doctype html>');
        write('assets/my page.png', 'x');

        expect(() => webBuildFiles(build())).toThrow('crossbind: the web build\'s "assets/my page.png" is at a path crossbind cloud keeps no snapshot\'s file at: letters, digits and _@.+- between slashes, none under __crossbind/, 255 characters at most. Rename it in the project.');
    });

    test.skipIf(process.platform === 'win32')('names a link in the web build, as a snapshot holds files alone', () => {
        write('index.html', '<!doctype html>');
        fs.symlinkSync(upath.join(build(), 'index.html'), upath.join(build(), 'linked.html'));

        expect(() => webBuildFiles(build())).toThrow("crossbind: the web build's linked.html is not a file, and a snapshot holds files alone.");
    });
});
