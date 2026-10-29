import { describe, expect, test, vi } from 'vitest';

// nm lists what each member of an archive calls, under the member's name.
const NM = {
    '/app/lib/iphoneos/0-libdemo.a': '\n/app/lib/iphoneos/0-libdemo.a(app.o):\n_malloc\n_mach_absolute_time\n',
    '/app/lib/iphoneos/3-libgdal.a': '\n/app/lib/iphoneos/3-libgdal.a(cpl.o):\n_stat\n_lstat\n_statvfs\n\n/app/lib/iphoneos/3-libgdal.a(vsi.o):\n_stat\n_getattrlist\n',
    '/app/lib/iphoneos/4-libz.a': '\n/app/lib/iphoneos/4-libz.a(gz.o):\n_read\n_write\n',
    // A linked app imports only what the linker kept of its archives.
    '/demo.xcarchive/Products/Applications/demo.app/demo': '_fstat\n_malloc\n_mach_absolute_time\n_statfs\n',
};
const spawnSync = vi.fn((program, args) => {
    const archive = args.at(-1);
    return archive in NM ? { status: 0, stdout: NM[archive], stderr: '' } : { status: 1, stdout: '', stderr: 'no such file' };
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));

const {
    reasonCategories, unreasonedApis, unreasonedImports, unreasonedWarning,
} = await import('../src/utils/requiredReasonApis.js');

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
        const archives = Object.keys(NM).filter((file) => file.endsWith('.a'));
        expect(unreasonedApis(archives, {})).toEqual([
            { library: 'demo', category: 'systemBootTime', symbols: ['_mach_absolute_time'] },
            { library: 'gdal', category: 'diskSpace', symbols: ['_getattrlist', '_statvfs'] },
            { library: 'gdal', category: 'fileTimestamp', symbols: ['_getattrlist', '_lstat', '_stat'] },
        ]);
        expect(unreasonedApis(archives, { fileTimestamp: ['C617.1'], diskSpace: ['E174.1'] }))
            .toEqual([{ library: 'demo', category: 'systemBootTime', symbols: ['_mach_absolute_time'] }]);
        // Xcode's nm, whatever nm comes first on the PATH, reading symbol tables alone: Rust's standard library embeds
        // bitcode of a newer LLVM than an older Xcode's reads.
        expect(spawnSync).toHaveBeenCalledWith('xcrun', ['nm', '--no-llvm-bc', '-u', '-j', '/app/lib/iphoneos/3-libgdal.a'], expect.objectContaining({ encoding: 'utf8' }));
    });

    test('stops when nm cannot read an archive', () => {
        expect(() => unreasonedApis(['/app/lib/iphoneos/9-libgone.a'], {})).toThrow('cannot list what /app/lib/iphoneos/9-libgone.a calls: no such file');
    });

    test("of a linked app is each category it imports that app.privacy gives no reason for, with the symbols", () => {
        const binary = '/demo.xcarchive/Products/Applications/demo.app/demo';
        expect(unreasonedImports(binary, {})).toEqual([
            { category: 'diskSpace', symbols: ['_statfs'] },
            { category: 'fileTimestamp', symbols: ['_fstat'] },
            { category: 'systemBootTime', symbols: ['_mach_absolute_time'] },
        ]);
        expect(unreasonedImports(binary, { fileTimestamp: ['C617.1'], diskSpace: ['E174.1'], systemBootTime: ['35F9.1'] })).toEqual([]);
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
