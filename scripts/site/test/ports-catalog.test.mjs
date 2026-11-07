import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BIN_TARGET,
    buildPortsCatalog,
    createFixtureRegistryClient,
    createRegistryClient,
    LIBRARY_TARGETS,
    NAPI_TARGET,
    readPortsTree,
    rememberingRegistryClient,
    renderCatalogModule,
    resolvePublication,
} from '../build-ports-catalog.mjs';

const silent = () => {};

test('every port family in the tree yields a catalog entry with canonical facts', async () => {
    const entries = await readPortsTree();
    assert.ok(entries.length >= 16, `expected the 16 known families, found ${entries.length}`);
    for (const entry of entries) {
        assert.match(entry.npm, /^@crossbind\/port-[a-z0-9]+$/);
        assert.ok(entry.name && entry.category && entry.summary, `${entry.family} lacks name/category/summary`);
        assert.match(entry.nativeVersion, /^\d+\.\d+(?:\.\d+)?$/);
        assert.ok(entry.license, `${entry.family} lacks a license`);
        assert.match(entry.upstreamSource ?? '', /^https:\/\//, `${entry.family} lacks an upstream source URL`);
        assert.equal(entry.repositoryUrl, `https://github.com/crossbind/crossbind/tree/main/ports/${entry.family}`);
        // The license text the library's packages ship, which the site links wherever it names the license.
        assert.equal(entry.licenseUrl, `https://github.com/crossbind/crossbind/blob/main/ports/${entry.family}/wasm/LICENSE`);
        for (const target of entry.targets) assert.equal(target.package, `${entry.npm}-${target.target}`);
        // Command tools come only from the standalone-wasi package, never from a web or wasi library build.
        const hasBin = entry.targets.some((target) => target.target === BIN_TARGET);
        assert.equal(entry.binCommands.length > 0, hasBin, `${entry.family}: binCommands must follow the standalone-wasi package`);
        for (const command of entry.binCommands) assert.match(command, /-wasi$/);
    }
    const gdal = entries.find((entry) => entry.family === 'gdal');
    assert.equal(gdal.name, 'GDAL');
    assert.ok(gdal.binCommands.includes('gdalinfo-wasi'));
    assert.deepEqual(LIBRARY_TARGETS, ['wasm', 'wasi', 'android', 'ios', 'darwin', 'linux', 'linuxmusl', 'win32']);
    assert.ok(['darwin', 'linux', 'linuxmusl', 'win32'].every((platform) => gdal.targets.some((target) => target.target === platform)));
    // The prebuilt Node-API package is a target of its own, so the site can offer it.
    assert.ok(gdal.targets.some((target) => target.target === NAPI_TARGET && target.package === '@crossbind/port-gdal-standalone-napi'));
});

test("a library whose wasi build brings data files or environment, its own or a dependency's, is marked", async () => {
    const entries = await readPortsTree();
    const marked = entries.filter((entry) => entry.hasWasiData).map((entry) => entry.family);
    assert.deepEqual(marked.sort(), ['curl', 'gdal', 'geotiff', 'openssl', 'proj', 'spatialite']);
});

test('publication comes from the dist-tag npm serves, not from the directory existing', async () => {
    const entries = [
        {
            family: 'demo',
            name: 'Demo',
            npm: '@crossbind/port-demo',
            targets: [
                { target: 'wasm', package: '@crossbind/port-demo-wasm' },
                { target: 'ios', package: '@crossbind/port-demo-ios' },
            ],
            binCommands: [],
        },
    ];
    const registry = createFixtureRegistryClient({
        npm: {
            packages: {
                '@crossbind/port-demo': { distTags: { beta: '2.0.0-beta.56', latest: '0.0.1' } },
                '@crossbind/port-demo-wasm': { distTags: { beta: '2.0.0-beta.56' } },
            },
        },
    });
    const logged = [];
    const [demo] = await resolvePublication(entries, { distTag: 'beta', registry, log: (line) => logged.push(line) });
    assert.equal(demo.published, '2.0.0-beta.56');
    assert.deepEqual(
        demo.targets.map((target) => [target.target, target.published]),
        [
            ['wasm', '2.0.0-beta.56'],
            ['ios', null],
        ],
    );
    assert.match(logged[0], /port-demo-ios/);
});

test('the registry client treats 404 as unpublished and other failures as errors', async () => {
    const okClient = createRegistryClient({
        fetchImplementation: async () => ({ ok: true, status: 200, json: async () => ({ 'dist-tags': { beta: '1.0.0' } }) }),
    });
    assert.deepEqual(await okClient.distTags('@crossbind/port-x'), { beta: '1.0.0' });
    const missing = createRegistryClient({ fetchImplementation: async () => ({ ok: false, status: 404 }) });
    assert.equal(await missing.distTags('@crossbind/port-x'), null);
    const broken = createRegistryClient({ fetchImplementation: async () => ({ ok: false, status: 503 }) });
    await assert.rejects(broken.distTags('@crossbind/port-x'), /HTTP 503/);
});

test('the registry client requests a scoped package by its escaped name', async () => {
    const requested = [];
    const client = createRegistryClient({
        fetchImplementation: async (url) => {
            requested.push(url);
            return { ok: true, status: 200, json: async () => ({}) };
        },
        registry: 'https://registry.example',
    });
    await client.distTags('@crossbind/port-x');
    assert.deepEqual(requested, ['https://registry.example/@crossbind%2fport-x']);
});

test('a remembering client asks the registry once for each package, however many catalogs list it', async () => {
    const asked = [];
    const client = rememberingRegistryClient({
        distTags: async (name) => {
            asked.push(name);
            return { beta: '2.0.0-beta.68' };
        },
    });

    await Promise.all([client.distTags('crossbind'), client.distTags('crossbind'), client.distTags('@crossbind/plugin-vite')]);

    assert.deepEqual(asked, ['crossbind', '@crossbind/plugin-vite']);
    assert.deepEqual(await client.distTags('crossbind'), { beta: '2.0.0-beta.68' });
});

test('a fixture build is marked as such and renders deterministically', async () => {
    const fixture = { npm: { packages: {} } };
    const catalog = await buildPortsCatalog({ distTag: 'beta', fixture, log: silent });
    assert.equal(catalog.source, 'fixture');
    assert.equal(catalog.distTag, 'beta');
    assert.ok(catalog.ports.every((port) => port.published === null));
    assert.equal(renderCatalogModule(catalog), renderCatalogModule(structuredClone(catalog)));
    await assert.rejects(buildPortsCatalog({ fixture, log: silent }), /dist-tag is required/);
});
