// What a playground project may depend on. The compiler image carries every one of these, installed or built, so a
// compile needs no network; the playground's package picker reads the same list. Each was built in the sandbox before
// it went in. `use` is how a project reaches it: an import from main.js, or an #include from its own C++, which spares
// a template library that binds nothing, and a large C header the build would otherwise make a bridge of.

const PORT_VERSION = '2.0.0-beta.63';

// A port's wasm package and the base package it depends on, as scripts/build-image.mjs packs them into the image, each
// checked against the integrity npm published.
const port = (name, summary, [wasmIntegrity, baseIntegrity], use) => ({
    id: `port:${name}`,
    source: 'port',
    name,
    version: PORT_VERSION,
    summary,
    package: `@crossbind/port-${name}-wasm`,
    tarballs: [
        { name: `@crossbind/port-${name}-wasm`, integrity: wasmIntegrity },
        { name: `@crossbind/port-${name}`, integrity: baseIntegrity },
    ],
    use,
});

export const PACKAGES = Object.freeze([
    port('expat', 'A streaming XML parser', [
        'sha512-5BpK7sF+WRbUCi6q/oeAjcL+8jzwfuUwhl3lkvd09V5OxR8LsFeuEju3bDU85JholBzkYBrEpw3nSBHQM5GjRg==',
        'sha512-2y+yNmX6C2Fi7U3BJVzyGf+NIc/Vo+BxFteXkQZ3iKck4MKnXFj1jGEdVuFn8pNVivoOy/nGQ2KC2c4xEUCiNA==',
    ], { include: '<expat.h>' }),
    port('iconv', 'Character set conversion', [
        'sha512-MGZvsuQLFInZg9tYCYIhZE1v0GPhq35CIBkFrFi76Wc9Q9xFG+iF+ciaP35K5k4ytGW9hqrgNiASvmYNlJHtfQ==',
        'sha512-hymSO29d0pDE8OuDcXND1qRTvCfAAkxQcYv2s3kt7yKKTqN1agxXDIGPpCF0kwhtSBYzucz1NxVx7Sm6CUg6Tw==',
    ], { include: '<iconv.h>' }),
    port('jpegturbo', 'JPEG encoding and decoding', [
        'sha512-e+vQMk5g2U0Q4ffe/9wsPfcW8uNorMIbG44K7UU8m1TN82FSgvSlBTOvDQHSnRsKl8vAmbfUgdB1qs+Mc3dLJA==',
        'sha512-U5RwIUw1HSVvq0tv8SjwftHfkMYKUz8+MOLMJDD9utY46Z4XGeyykS/MOpLq+pl3fy4XG8E/fAnYDwornWTy5A==',
    ], { include: '<turbojpeg.h>' }),
    port('lerc', 'Limited Error Raster Compression', [
        'sha512-lI4pf6fHPzPcoIZQw2ynftdMVuOTtNglZ6jelVe8ZTLR37NMR4Fc/schWsp2azETMf4J5lhcgiIurVOiqJz1mw==',
        'sha512-VDVorMk3fOZ0jybTcyUex0WZcaMIqechtmxx6xEds3H2NmPROD+F4yc+v/rhh97TvNFN4oeMZtRWRoDUM4rrzg==',
    ], { include: '<Lerc_c_api.h>' }),
    port('sqlite3', 'The SQL database engine', [
        'sha512-inel8kUWibgwpblsEPU/5SHT2toetZGiAwOauzARDoFpwv5zF2+etP3NiS25QZrUMJIyN3kvVPBm8uEBPWTl3A==',
        'sha512-cJu4PCs0OHrAeEJ/A+6ryTRE6xlnVHJYNxhUnmmRjNGY7NiJRnrtvzNvL1fQ+VSECG9hxmueDb31yUCAvHf83g==',
    ], { import: '@crossbind/port-sqlite3/sqlite3.h', names: ['sqlite3_libversion'] }),
    port('tiff', 'TIFF images', [
        'sha512-hYyrLuJXMCsrqLFq8ifh4TUz3cf18+VbopJr3uP854oEIQfB0oVt/ISsIdyWC+i7V++6zrvHDnjlu8+6/zszmA==',
        'sha512-QYqPFQVm6dPiCGOLjRnu4WNGPatgzGiBDdtMaDinZHzvtJPPW9ggt8uRVOvXrcvTbTHP8jsGUsmYhJZfHFziSQ==',
    ], { include: '<tiffio.h>' }),
    port('webp', 'WebP image encoding and decoding', [
        'sha512-UDzZH+r0sV3sLnCNQLU2Iv27uriARqZsoJGha5ijo1iWck3GMrq0dizk6zMgnTCG/CmUExCtR4/w9LNYu5kemg==',
        'sha512-H1TvWFhC1LSvIBYTX3xYPOthSOS7WBC6EsdqfsOh2PN9pe6HVCoRhLUo748HLu5DHdYdC0c5unLj76Z9bAClCg==',
    ], { include: '<webp/encode.h>' }),
    port('zlib', 'Deflate compression', [
        'sha512-SKlYei0qNByv2OHsoI6b836mxFmUEILybW/aBwCTfnVqTAtyYybuOOmAd4inAsNwkTG2wtzXVawWXLYJLSRbPg==',
        'sha512-H8zr7GUP0t79ei3RI/HsBowaPq2urD+4hqmsv9wBGXPczlYZ5TvavdpIG8sJlXpJTXTMXye6AHa1d2yXLo3Erg==',
    ], { include: '<zlib.h>' }),
    port('zstd', 'Fast lossless compression', [
        'sha512-3NhP84Rx1Lhzuq9a6kWQTzXS3lHY34okZIObJnyy4MrskLyy8tRkhlh8RRSUmNLvC3coaLZ6Cniztni9pfRr9g==',
        'sha512-5HHqUypn+U9g+TjjjYbEaL6gfqxJonFATOfZlQpRGL+hnZDv3WFnsxG5cT94OItRRWB836fbS5h85M/u8jDOgg==',
    ], { include: '<zstd.h>' }),
    {
        id: 'crate:uuid',
        source: 'crate',
        name: 'uuid',
        version: '1.28.0',
        summary: 'Generate and parse UUIDs',
        spec: '{ version = "=1.28.0", features = ["v4"] }',
        use: { import: 'cargo:uuid', names: ['Uuid'] },
    },
    {
        id: 'crate:semver',
        source: 'crate',
        name: 'semver',
        version: '1.0.28',
        summary: 'Semantic versions and requirements',
        spec: '=1.0.28',
        use: { import: 'cargo:semver', names: ['Version', 'VersionReq'] },
    },
    {
        id: 'crate:regex',
        source: 'crate',
        name: 'regex',
        version: '1.13.1',
        summary: 'Regular expressions',
        spec: '=1.13.1',
        use: { import: 'cargo:regex', names: ['Regex'] },
    },
    {
        id: 'conan:zlib',
        source: 'conan',
        name: 'zlib',
        version: '1.3.2',
        summary: 'Deflate compression',
        use: { import: 'conan:zlib/zlib.h', names: ['zlibVersion'] },
    },
    {
        id: 'conan:cjson',
        source: 'conan',
        name: 'cjson',
        version: '1.7.19',
        summary: 'A JSON parser in C',
        use: { import: 'conan:cjson/cjson/cJSON.h', names: ['cJSON_Version'] },
    },
    {
        id: 'conan:fmt',
        source: 'conan',
        name: 'fmt',
        version: '12.2.0',
        summary: 'Text formatting for C++',
        use: { include: '<fmt/format.h>' },
    },
    {
        id: 'conan:nlohmann_json',
        source: 'conan',
        name: 'nlohmann_json',
        version: '3.12.0',
        summary: 'JSON for modern C++',
        use: { include: '<nlohmann/json.hpp>' },
    },
].map((pkg) => Object.freeze({ ...pkg, use: Object.freeze(pkg.use) })));

const BY_ID = new Map(PACKAGES.map((pkg) => [pkg.id, pkg]));

export function packagesFor(ids) {
    return ids.map((id) => {
        const pkg = BY_ID.get(id);
        if (!pkg) throw new Error(`The playground has no package ${JSON.stringify(id)}.`);
        return pkg;
    });
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
export const bindingOf = (name) => name.replace(/\W/g, '_');
const keyOf = (name) => (IDENTIFIER.test(name) ? name : `'${name}'`);
const quoted = (text) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

// The project's crossbind.config.js, written by the compiler and never sent by a visitor: a config is JavaScript the
// build would run. The playground shows it as it is, so it reads like one a person wrote.
export function configSource(ids) {
    const chosen = packagesFor(ids);
    const ports = chosen.filter(({ source }) => source === 'port');
    const indented = (lines) => lines.map((line) => `    ${line}`);
    const block = (field, lines) => (lines.length ? [`${field}: {`, ...indented(lines), '},'] : []);
    const entries = (source, value) => chosen.filter((pkg) => pkg.source === source).map((pkg) => `${keyOf(pkg.name)}: ${quoted(value(pkg))},`);
    return [
        ...ports.map((pkg) => `import ${bindingOf(pkg.name)} from '${pkg.package}/crossbind.config.js';`),
        ...(ports.length ? [''] : []),
        'export default {',
        "    general: { name: 'playground' },",
        ...(ports.length ? [`    dependencies: [${ports.map((pkg) => bindingOf(pkg.name)).join(', ')}],`] : []),
        ...indented(block('packages', [
            ...block('cargo', entries('crate', ({ spec }) => spec)),
            ...block('conan', entries('conan', ({ version }) => version)),
        ])),
        '    paths: { config: import.meta.url },',
        '};',
        '',
    ].join('\n');
}
