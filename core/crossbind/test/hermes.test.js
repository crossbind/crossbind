import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The downloader leaves the release's tree, every Apple platform's dSYM, with the archive beside it, and keeps it after.
const download = vi.fn(async (url, output) => {
    if (fs.existsSync(`${output}/source`)) return false;
    ['iphoneos', 'iphonesimulator', 'macosx'].forEach((platform) => fs.mkdirSync(`${output}/source/${platform}/hermesvm.framework.dSYM`, { recursive: true }));
    fs.writeFileSync(`${output}/${path.basename(url)}`, 'archive');
    return true;
});
vi.mock('../src/utils/downloadAndExtractFile.js', () => ({ default: download }));
const said = [];
vi.mock('../src/utils/logger.js', () => ({ default: { info: (line) => said.push(line) } }));

const { HERMES, HERMES_DSYM, resolveHermesDsym } = await import('../src/utils/hermes.js');

let home;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-hermes-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    download.mockClear();
    said.length = 0;
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
});

describe("Hermes' dSYM", () => {
    test("comes from the release's pinned archive, of which the device's dSYM alone stays, downloaded once", async () => {
        const dir = path.join(home, '.crossbind', 'hermes', `${HERMES.version}-dsym`);
        expect(await resolveHermesDsym()).toBe(`${dir}/source/iphoneos/hermesvm.framework.dSYM`);
        expect(download).toHaveBeenCalledWith(HERMES_DSYM.url, dir, HERMES_DSYM.sha256);
        expect(fs.readdirSync(dir)).toEqual(['source']);
        expect(fs.readdirSync(`${dir}/source`)).toEqual(['iphoneos']);
        expect(said).toEqual([expect.stringContaining(`downloading the dSYM of Hermes ${HERMES.version} once`)]);

        await resolveHermesDsym();
        expect(said).toHaveLength(1);
    });
});
