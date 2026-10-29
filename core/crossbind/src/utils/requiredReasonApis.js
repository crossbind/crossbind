import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The C symbols of Apple's required reason API an iOS archive can import, each with its categories; getattrlist and its
// kin are in two. A selector, as systemUptime or activeInputModes is, is no symbol, so nm finds none of those.
const SYMBOLS = {
    _stat: ['fileTimestamp'],
    _fstat: ['fileTimestamp'],
    _fstatat: ['fileTimestamp'],
    _lstat: ['fileTimestamp'],
    _getattrlistbulk: ['fileTimestamp'],
    _getattrlist: ['fileTimestamp', 'diskSpace'],
    _fgetattrlist: ['fileTimestamp', 'diskSpace'],
    _getattrlistat: ['fileTimestamp', 'diskSpace'],
    _statfs: ['diskSpace'],
    _statvfs: ['diskSpace'],
    _fstatfs: ['diskSpace'],
    _fstatvfs: ['diskSpace'],
    _mach_absolute_time: ['systemBootTime'],
    '_OBJC_CLASS_$_NSUserDefaults': ['userDefaults'],
};
// nm's list of a large library, as GDAL's, runs to megabytes.
const NM_OUTPUT_LIMIT = 256 * 1024 * 1024;

// The categories that the symbols of `nm -u -j` output call, each with those symbols.
export function reasonCategories(output) {
    const categories = new Map();
    output.split('\n').map((line) => line.trim()).filter((symbol) => Object.hasOwn(SYMBOLS, symbol)).forEach((symbol) => {
        SYMBOLS[symbol].forEach((category) => categories.set(category, (categories.get(category) ?? new Set()).add(symbol)));
    });
    return categories;
}

// The categories an archive or a linked binary imports, as Xcode's nm lists them, whatever nm comes first on the PATH.
// Its LLVM bitcode reader stays off: the symbol table tells all, and the bitcode Rust's standard library embeds comes
// from a newer LLVM than an older Xcode reads.
function importedCategories(file) {
    const result = spawnSync('xcrun', ['nm', '--no-llvm-bc', '-u', '-j', file], { encoding: 'utf8', maxBuffer: NM_OUTPUT_LIMIT });
    if (result.status !== 0) throw new Error(`crossbind: cannot list what ${file} calls: ${result.stderr || result.error?.message}`);
    return reasonCategories(result.stdout);
}

// What the archives an iOS app links call of required reason API with no reason in app.privacy: each library, by the
// name its archive has, with each such category and its symbols.
export function unreasonedApis(archives, privacy) {
    const found = new Map();
    archives.forEach((archive) => {
        const library = path.basename(archive).replace(/^\d+-/, '').replace(/^lib/, '').replace(/\.a$/, '');
        importedCategories(archive).forEach((symbols, category) => {
            if (Object.hasOwn(privacy, category)) return;
            const key = `${library}\0${category}`;
            found.set(key, new Set([...(found.get(key) ?? []), ...symbols]));
        });
    });
    return [...found].map(([key, symbols]) => {
        const [library, category] = key.split('\0');
        return { library, category, symbols: [...symbols].sort() };
    }).sort((a, b) => a.library.localeCompare(b.library) || a.category.localeCompare(b.category));
}

// What an iOS app's linked binary calls of required reason API with no reason in app.privacy, each category with its
// symbols: what the linker kept of its archives, which App Store Connect checks.
export const unreasonedImports = (binary, privacy) => [...importedCategories(binary)]
    .filter(([category]) => !Object.hasOwn(privacy, category))
    .map(([category, symbols]) => ({ category, symbols: [...symbols].sort() }))
    .sort((a, b) => a.category.localeCompare(b.category));

// The warning of what the archives of an iOS app reference of required reason API without its reasons, or none. The
// linker may leave some of it out of the app, as it left _stat, _lstat and _fstatat out of the conformance app, whose
// Rust references them; the app keeps what it calls.
export function unreasonedWarning(found) {
    if (found.length === 0) return null;
    const uses = new Map();
    found.forEach(({ library, category, symbols }) => uses.set(library, [...(uses.get(library) ?? []), `${category} (${symbols.join(', ')})`]));
    const references = [...uses].map(([library, list]) => `${library} references ${list.join(' and ')}`).join('; ');
    return `crossbind: App Store Connect refuses an iOS app that calls required reason API without its reasons (ITMS-91053), and the archives this app links reference some with no reason in app.privacy: ${references}. The linker may leave some out. Give app.privacy Apple's reasons for what the app calls, as { fileTimestamp: ['C617.1'] }; Apple's "Describing use of required reason API" says what each covers.`;
}
