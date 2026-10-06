import fs from 'node:fs';

// A cmake package that ships its sources rather than a prebuilt: its own CMakeLists (at the package root, not a
// generated dist/prebuilt one) is compiled into the consuming build via add_subdirectory.
export default function isSourceCmakePackage(config) {
    return config.export?.type === 'cmake'
        && config.paths.cmake !== config.paths.cliCMakeListsTxt
        && !config.paths.cmakeDir.endsWith('/prebuilt')
        && fs.existsSync(config.paths.cmake);
}
