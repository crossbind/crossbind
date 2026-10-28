import { describe, expect, test, vi } from 'vitest';

// nm lists what each member of an archive calls, under the member's name.
const NM = {
    '/app/lib/iphoneos/0-libdemo.a': '\n/app/lib/iphoneos/0-libdemo.a(app.o):\n_malloc\n_mach_absolute_time\n',
    '/app/lib/iphoneos/3-libgdal.a': '\n/app/lib/iphoneos/3-libgdal.a(cpl.o):\n_stat\n_lstat\n_statvfs\n\n/app/lib/iphoneos/3-libgdal.a(vsi.o):\n_stat\n_getattrlist\n',
    '/app/lib/iphoneos/4-libz.a': '\n/app/lib/iphoneos/4-libz.a(gz.o):\n_read\n_write\n',
};
const spawnSync = vi.fn((program, [, , archive]) => (archive in NM ? { status: 0, stdout: NM[archive], stderr: '' } : { status: 1, stdout: '', stderr: 'no such file' }));
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));

const { reasonCategories, unreasonedApis, unreasonedWarning } = await import('../src/utils/requiredReasonApis.js');

describe("an iOS app's required reason API", () => {
    test("is what the symbols an archive imports call, by Apple's categories; getattrlist is in two", () => {
        const categories = reasonCategories('_stat\n_read\n_getattrlist\n_OBJC_CLASS_$_NSUserDefaults\n_toString\n');
        expect(Object.fromEntries([...categories].map(([category, symbols]) => [category, [...symbols]]))).toEqual({
            fileTimestamp: ['_stat', '_getattrlist'],
            diskSpace: ['_getattrlist'],
            userDefaults: ['_OBJC_CLASS_$_NSUserDefaults'],
        });
    });

    test('names each library that calls a category app.privacy gives no reason for, with the symbols', () => {
        const archives = Object.keys(NM);
        expect(unreasonedApis(archives, {})).toEqual([
            { library: 'demo', category: 'systemBootTime', symbols: ['_mach_absolute_time'] },
            { library: 'gdal', category: 'diskSpace', symbols: ['_getattrlist', '_statvfs'] },
            { library: 'gdal', category: 'fileTimestamp', symbols: ['_getattrlist', '_lstat', '_stat'] },
        ]);
        expect(unreasonedApis(archives, { fileTimestamp: ['C617.1'], diskSpace: ['E174.1'] }))
            .toEqual([{ library: 'demo', category: 'systemBootTime', symbols: ['_mach_absolute_time'] }]);
        expect(spawnSync).toHaveBeenCalledWith('nm', ['-u', '-j', '/app/lib/iphoneos/3-libgdal.a'], expect.objectContaining({ encoding: 'utf8' }));
    });

    test('stops when nm cannot read an archive', () => {
        expect(() => unreasonedApis(['/app/lib/iphoneos/9-libgone.a'], {})).toThrow('cannot list what /app/lib/iphoneos/9-libgone.a calls: no such file');
    });
});

describe('the warning of required reason API without reasons', () => {
    test('names each library with what its archive references, which the linker may leave out, and how app.privacy gives the reasons', () => {
        const warning = unreasonedWarning([
            { library: 'demo', category: 'systemBootTime', symbols: ['_mach_absolute_time'] },
            { library: 'gdal', category: 'diskSpace', symbols: ['_statvfs'] },
            { library: 'gdal', category: 'fileTimestamp', symbols: ['_lstat', '_stat'] },
        ]);
        expect(warning).toContain('(ITMS-91053)');
        expect(warning).toContain('demo references systemBootTime (_mach_absolute_time); gdal references diskSpace (_statvfs) and fileTimestamp (_lstat, _stat).');
        expect(warning).toContain('The linker may leave some out.');
        expect(warning).toContain("app.privacy Apple's reasons for what the app calls, as { fileTimestamp: ['C617.1'] }");
    });

    test('is none when every call has its reason', () => {
        expect(unreasonedWarning([])).toBe(null);
    });
});
