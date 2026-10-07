const fs = require('node:fs');
const path = require('node:path');
const { test: base, expect, _electron: electron } = require('@playwright/test');

const test = base.extend({ packaged: [false, { option: true }] });

const APP_DIR = path.resolve(__dirname, '..');
// A CI Linux has no setuid sandbox helper, and the test needs no sandbox.
const ARGS = process.platform === 'linux' ? ['--no-sandbox'] : [];

// The same Electron runs the app.asar `electron-builder --dir` wrote last, and reads what the archive
// keeps unpacked from the app.asar.unpacked beside it, as the packaged executable does.
function packagedApp() {
    const out = path.join(APP_DIR, 'out');
    const archives = fs.existsSync(out)
        ? fs.readdirSync(out, { recursive: true }).filter((file) => path.basename(file) === 'app.asar').map((file) => path.join(out, file))
        : [];
    if (archives.length === 0) throw new Error('no out/**/app.asar - run `electron-builder --dir` first');
    return archives.reduce((newest, file) => (fs.statSync(file).mtimeMs > fs.statSync(newest).mtimeMs ? file : newest));
}

test('check string receiving from c++', async ({ packaged }) => {
    const app = await electron.launch({ args: [...ARGS, packaged ? packagedApp() : APP_DIR] });
    try {
        const window = await app.firstWindow();
        await expect(window.locator('#cppMessage')).toHaveText('J₃ * (2*J₃) = 6*J₃');
    } finally {
        await app.close();
    }
});
