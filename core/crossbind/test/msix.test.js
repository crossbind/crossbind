import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import upath from 'upath';
import { PNG } from 'pngjs';
import {
    afterAll, afterEach, describe, expect, test, vi,
} from 'vitest';
import msix, { msixVersion, storeIdentity } from '../../../extensions/msix/crossbind.extension.js';
import { appxManifest } from '../../../extensions/msix/src/manifest.js';
import { partName, writeMsix } from '../../../extensions/msix/src/pack.js';
import { commonName, windowsPublisher } from '../../../extensions/msix/src/publisher.js';

// A certificate whose subject has a name of each kind Windows names its own way, a comma, quotes and Turkish letters:
// C=TR, ST=İstanbul, L=Kadıköy, O=Örnek, Ltd. "Şti", CN=Buğra Sarı.
const CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICuTCCAl4CCQDFHxxziwqxtTAKBggqhkjOPQQDAjBqMQswCQYDVQQGEwJUUjES
MBAGA1UECAwJxLBzdGFuYnVsMRIwEAYDVQQHDAlLYWTEsWvDtnkxHDAaBgNVBAoM
E8OWcm5laywgTHRkLiAixZ50aSIxFTATBgNVBAMMDEJ1xJ9yYSBTYXLEsTAeFw0y
NjExMTYwNTMwNDVaFw0zNjExMTMwNTMwNDVaMGoxCzAJBgNVBAYTAlRSMRIwEAYD
VQQIDAnEsHN0YW5idWwxEjAQBgNVBAcMCUthZMSxa8O2eTEcMBoGA1UECgwTw5Zy
bmVrLCBMdGQuICLFnnRpIjEVMBMGA1UEAwwMQnXEn3JhIFNhcsSxMIIBSzCCAQMG
ByqGSM49AgEwgfcCAQEwLAYHKoZIzj0BAQIhAP////8AAAABAAAAAAAAAAAAAAAA
////////////////MFsEIP////8AAAABAAAAAAAAAAAAAAAA///////////////8
BCBaxjXYqjqT57PrvVV2mIa8ZR0GsMxTsPY7zjw+J9JgSwMVAMSdNgiG5wSTamZ4
4ROdJreBn36QBEEEaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpZP40Li
/hp/m47n60p8D54WK84zV2sxXs7LtkBoN79R9QIhAP////8AAAAA//////////+8
5vqtpxeehPO5ysL8YyVRAgEBA0IABIE3eMAfLm+6vHIEm9PoIh5HKqVdH0JZILaw
XHjRpiSSUjCqYUe+OvbZ9qEtu6ij48BTf7/jGUbtIhRFVfFsHLkwCgYIKoZIzj0E
AwIDSQAwRgIhAJ+lIiGrxaKmoe6bOz1fM3Bj//cmcRG1TqM+xOjnCFtJAiEAxTsr
zeBSGkvOTdLIdSo+CmxUCWuszv43ASiJep/visI=
-----END CERTIFICATE-----
`;
const PUBLISHER = 'CN=Buğra Sarı, O="Örnek, Ltd. ""Şti""", L=Kadıköy, S=İstanbul, C=TR';
const BLOCK = 65536;
const STORE = { name: '12345Example.Demo', publisher: 'CN=1A2B3C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D', publisherDisplayName: 'Example' };

const roots = [];
afterAll(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
afterEach(() => vi.unstubAllEnvs());

function folder() {
    const root = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-msix-')));
    roots.push(root);
    return root;
}

// A package as a ZIP reader that knows nothing of the packer reads it: through the ZIP64 end records to the central
// directory, and each entry's local header and data.
function readPackage(file) {
    const bytes = fs.readFileSync(file);
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(bytes.readUInt32LE(end - 20)).toBe(0x07064b50);
    const zip64 = Number(bytes.readBigUInt64LE(end - 12));
    expect(bytes.readUInt32LE(zip64)).toBe(0x06064b50);
    const count = Number(bytes.readBigUInt64LE(zip64 + 32));
    let at = Number(bytes.readBigUInt64LE(zip64 + 48));
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        const nameLength = bytes.readUInt16LE(at + 28);
        const offset = bytes.readUInt32LE(at + 42);
        const lfhSize = 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
        const method = bytes.readUInt16LE(at + 10);
        const data = bytes.subarray(offset + lfhSize, offset + lfhSize + bytes.readUInt32LE(at + 20));
        entries.push({
            name: bytes.toString('utf8', at + 46, at + 46 + nameLength), method, crc: bytes.readUInt32LE(at + 16), lfhSize, data,
            content: method === 8 ? zlib.inflateRawSync(data) : data,
        });
        at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    }
    return entries;
}
const textOf = (entries, name) => entries.find((entry) => entry.name === name).content.toString('utf8');
const png = (size) => PNG.sync.write({ width: size, height: size, data: Buffer.alloc(size * size * 4, 200) });

describe("an MSIX package's archive", () => {
    const files = () => [
        { name: 'demo.exe', data: crypto.randomBytes(2 * BLOCK + 1000) },
        { name: 'resources/logo.png', data: crypto.randomBytes(BLOCK + 10) },
        { name: 'resources/notes.txt', data: Buffer.from('notes '.repeat(30000)) },
        { name: 'resources/empty.js', data: Buffer.alloc(0) },
    ];

    test('holds the files whole, then the manifest, the block map and the content types', () => {
        const given = files();
        const out = upath.join(folder(), 'demo.msix');
        writeMsix({ files: given, manifest: '<Package/>' }, out);

        const entries = readPackage(out);
        expect(entries.map(({ name }) => name)).toEqual([...given.map(({ name }) => name), 'AppxManifest.xml', 'AppxBlockMap.xml', '[Content_Types].xml']);
        given.forEach(({ data }, index) => {
            expect(entries[index].content.equals(data)).toBe(true);
            expect(entries[index].crc).toBe(zlib.crc32(data));
        });
        // The SDK stores what is compressed already.
        expect(entries.map(({ method }) => method)).toEqual([8, 0, 8, 8, 8, 8, 8]);
        expect(textOf(entries, 'AppxManifest.xml')).toBe('<Package/>');
    });

    test('maps each 64 KB block of every file but its own by its hash, and a deflated one by the size it deflates to alone', () => {
        const out = upath.join(folder(), 'demo.msix');
        writeMsix({ files: files(), manifest: '<Package/>' }, out);

        const entries = readPackage(out);
        const map = [...textOf(entries, 'AppxBlockMap.xml').matchAll(/<File Name="([^"]*)" Size="(\d+)" LfhSize="(\d+)">(.*?)<\/File>/g)];
        expect(map.map(([, name]) => name)).toEqual(['demo.exe', 'resources\\logo.png', 'resources\\notes.txt', 'resources\\empty.js', 'AppxManifest.xml']);
        for (const [, name, size, lfhSize, blocks] of map) {
            const entry = entries.find((candidate) => candidate.name === name.replaceAll('\\', '/'));
            expect([Number(size), Number(lfhSize)]).toEqual([entry.content.length, entry.lfhSize]);
            let at = 0;
            let plainAt = 0;
            for (const [, hash, blockSize] of blocks.matchAll(/<Block Hash="([^"]+)"(?: Size="(\d+)")?\/>/g)) {
                const plain = entry.method === 8
                    ? zlib.inflateRawSync(entry.data.subarray(at, at + Number(blockSize)), { finishFlush: zlib.constants.Z_SYNC_FLUSH })
                    : entry.data.subarray(at, at + BLOCK);
                expect(blockSize === undefined).toBe(entry.method === 0);
                expect(plain.equals(entry.content.subarray(plainAt, plainAt + BLOCK))).toBe(true);
                expect(crypto.createHash('sha256').update(plain).digest('base64')).toBe(hash);
                at += entry.method === 8 ? Number(blockSize) : plain.length;
                plainAt += plain.length;
            }
            expect(plainAt).toBe(entry.content.length);
            // A deflated file ends in an empty final block.
            expect(entry.data.subarray(at).toString('hex')).toBe(entry.method === 8 ? '0300' : '');
        }
    });

    test("types each file by its extension's first type, and the manifest, the block map and a file without one apart", () => {
        const out = upath.join(folder(), 'demo.msix');
        writeMsix({ files: [{ name: 'data.xml', data: Buffer.from('<a/>') }, { name: 'LICENSE', data: Buffer.from('MIT') }, { name: 'a.css', data: Buffer.from('') }], manifest: '<Package/>' }, out);
        expect(textOf(readPackage(out), '[Content_Types].xml')).toContain('<Default Extension="xml" ContentType="text/xml"/><Override PartName="/LICENSE" ContentType="application/octet-stream"/>'
            + '<Default Extension="css" ContentType="text/css"/><Override PartName="/AppxManifest.xml" ContentType="application/vnd.ms-appx.manifest+xml"/>'
            + '<Override PartName="/AppxBlockMap.xml" ContentType="application/vnd.ms-appx.blockmap+xml"/></Types>');

        writeMsix({ files: [{ name: 'a.wasm', data: Buffer.from('') }], manifest: '<Package/>' }, out);
        expect(textOf(readPackage(out), '[Content_Types].xml')).toContain('<Default Extension="wasm" ContentType="application/octet-stream"/>'
            + '<Default Extension="xml" ContentType="application/vnd.ms-appx.manifest+xml"/><Override PartName="/AppxBlockMap.xml"');
    });

    test('names a file in the archive as the SDK encodes it, and in the block map as it is', () => {
        expect(partName('dir\\a b%#ü.txt')).toBe('dir/a%20b%25%23%C3%BC.txt');
        const out = upath.join(folder(), 'demo.msix');
        writeMsix({ files: [{ name: 'a b/ü&.txt', data: Buffer.from('x') }], manifest: '<Package/>' }, out);

        const entries = readPackage(out);
        expect(entries[0].name).toBe('a%20b/%C3%BC%26.txt');
        // The local header is 30 bytes and the name's 19 as the archive encodes it.
        expect(textOf(entries, 'AppxBlockMap.xml')).toContain('<File Name="a b\\ü&amp;.txt" Size="1" LfhSize="49">');
    });

    test('refuses a file of the app named as one the package makes itself', () => {
        const out = upath.join(folder(), 'demo.msix');
        for (const name of ['AppxManifest.xml', 'appxblockmap.xml', '[content_types].xml', 'AppxSignature.p7x', 'AppxMetadata/CodeIntegrity.cat']) {
            expect(() => writeMsix({ files: [{ name, data: Buffer.from('') }], manifest: '<Package/>' }, out)).toThrow(`crossbind: ${name} is a file an MSIX package makes itself`);
        }
    });
});

describe("an MSIX package's manifest", () => {
    const manifest = (extra = {}) => appxManifest({
        identity: { name: 'dev.example.demo', publisher: 'CN=Ex & Co', version: '1.2.3.0', arch: 'arm64' },
        displayName: 'Demo <1>',
        publisherDisplayName: 'Ex & Co',
        description: 'A demo',
        executable: 'demo.exe',
        ...extra,
    });

    test('names the app, its executable with full trust, its logos, and escapes what it is given', () => {
        const text = manifest();
        expect(text).toContain('<Identity Name="dev.example.demo" Publisher="CN=Ex &amp; Co" Version="1.2.3.0" ProcessorArchitecture="arm64"/>');
        expect(text).toContain('<DisplayName>Demo &lt;1&gt;</DisplayName>');
        expect(text).toContain('<TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0"/>');
        expect(text).toContain('<Application Id="App" Executable="demo.exe" EntryPoint="Windows.FullTrustApplication">');
        expect(text).toContain('Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png"/>');
        expect(text).toContain('<rescap:Capability Name="runFullTrust"/>');
        expect(text).not.toContain('<Extensions>');
    });

    test('opens the app by its alias, and with the link or file of its URL schemes and file types, as its setup program does', () => {
        const text = manifest({
            urlSchemes: ['demo'],
            fileTypes: [{ name: 'Geo "JSON"', extensions: ['geojson', 'geo'], mimeTypes: ['application/geo+json'] }, { name: 'Track', extensions: ['trk'], mimeTypes: [] }],
            alias: 'demo.exe',
        });
        expect(text).toContain('<uap3:Extension Category="windows.protocol"><uap3:Protocol Name="demo" Parameters="&quot;%1&quot;"/></uap3:Extension>');
        expect(text).toContain('<uap3:FileTypeAssociation Name="geojson" Parameters="&quot;%1&quot;"><uap:DisplayName>Geo &quot;JSON&quot;</uap:DisplayName>'
            + '<uap:SupportedFileTypes><uap:FileType ContentType="application/geo+json">.geojson</uap:FileType><uap:FileType ContentType="application/geo+json">.geo</uap:FileType>');
        expect(text).toContain('<uap:FileType>.trk</uap:FileType>');
        expect(text).toContain('<uap3:AppExecutionAlias><desktop:ExecutionAlias Alias="demo.exe"/></uap3:AppExecutionAlias>');
    });
});

describe("a handed-out MSIX package's publisher", () => {
    test("is its signing certificate's subject as Windows writes it, its most particular name first", () => {
        const { subject } = new crypto.X509Certificate(CERTIFICATE);
        expect(windowsPublisher(subject)).toBe(PUBLISHER);
        expect(commonName(subject)).toBe('Buğra Sarı');
        expect(windowsPublisher('CN=crossbind e2e')).toBe('CN=crossbind e2e');
        expect(windowsPublisher('C=US\nO=A \\+ B\nOU=Dev + CN=Ann')).toBe('OU=Dev + CN=Ann, O="A + B", C=US');
    });
});

describe('the msix installer', () => {
    const { check, make } = msix().installer;

    // An installer's api, as crossbind gives one, for a Windows app in dist/ of a project.
    function apiOf({ app = {}, version = '1.2.3', signer = null } = {}) {
        const root = folder();
        const dist = upath.join(root, 'dist');
        fs.mkdirSync(upath.join(dist, 'demo-win32-x64/resources'), { recursive: true });
        fs.writeFileSync(upath.join(dist, 'demo-win32-x64/demo.exe'), 'MZ');
        fs.writeFileSync(upath.join(dist, 'demo-win32-x64/resources/host.hbc'), 'hbc');
        const run = vi.fn();
        const api = {
            config: { app: { icon: 'icon.png', ...app } },
            app: { id: 'dev.example.demo', name: 'Demo', version, urlSchemes: ['demo'], fileTypes: [] },
            project: { name: 'demo', package: { description: 'A demo app' } },
            windows: { signer, logo: png },
            workDir: upath.join(root, 'build/msix'),
            run,
        };
        return { api, app: upath.join(dist, 'demo-win32-x64'), run };
    }

    test("makes the Store's package with app.windows.msix, which it leaves for the Store to sign", () => {
        const { api, app, run } = apiOf({ app: { windows: { msix: STORE } }, signer: '/host/jsign.sh' });
        expect(() => check(api)).not.toThrow();

        expect(make(api, { app, arch: 'x64' })).toEqual([`${app}.msix`]);
        const entries = readPackage(`${app}.msix`);
        const manifest = textOf(entries, 'AppxManifest.xml');
        expect(manifest).toContain(`<Identity Name="${STORE.name}" Publisher="${STORE.publisher}" Version="1.2.3.0" ProcessorArchitecture="x64"/>`);
        expect(manifest).toContain('<PublisherDisplayName>Example</PublisherDisplayName>');
        expect(manifest).toContain('Description="A demo app"');
        expect(manifest).toContain('<uap3:Protocol Name="demo"');
        expect(manifest).toContain('<desktop:ExecutionAlias Alias="demo.exe"/>');
        expect(entries.map(({ name }) => name)).toEqual(['demo.exe', 'resources/host.hbc', 'Assets/StoreLogo.png', 'Assets/Square150x150Logo.png', 'Assets/Square44x44Logo.png',
            'AppxManifest.xml', 'AppxBlockMap.xml', '[Content_Types].xml']);
        expect(entries.slice(2, 5).map(({ content }) => PNG.sync.read(content).width)).toEqual([50, 150, 44]);
        expect(run).not.toHaveBeenCalled();
    });

    test("makes a handed-out package where app.installers names msix, of the app's id and its signing certificate's subject, and signs it", () => {
        const { api, app, run } = apiOf({ app: { installers: ['msix'] }, signer: '/host/jsign.sh' });
        const certfile = upath.join(folder(), 'signer.pem');
        fs.writeFileSync(certfile, CERTIFICATE);
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_CERTFILE', certfile);

        expect(make(api, { app, arch: 'arm64' })).toEqual([`${app}.msix`]);
        const manifest = textOf(readPackage(`${app}.msix`), 'AppxManifest.xml');
        expect(manifest).toContain('<Identity Name="dev.example.demo" Publisher="CN=Buğra Sarı, O=&quot;Örnek, Ltd. &quot;&quot;Şti&quot;&quot;&quot;, L=Kadıköy, S=İstanbul, C=TR" Version="1.2.3.0" ProcessorArchitecture="arm64"/>');
        expect(manifest).toContain('<PublisherDisplayName>Buğra Sarı</PublisherDisplayName>');
        expect(run).toHaveBeenCalledWith(['sh', '/host/jsign.sh', 'demo-win32-x64.msix'], { cwd: upath.dirname(app), isSigning: true });
    });

    test("reads a keystore's certificate with keytool in the windows image, where the keystore is", () => {
        const { api, app, run } = apiOf({ app: { installers: ['msix'] }, signer: '/host/jsign.sh' });
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_CERTFILE', '');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'pkcs12');
        run.mockImplementationOnce((command, { cwd }) => fs.writeFileSync(upath.join(cwd, command.at(-1)), `Alias name: signer\nCertificate[1]:\n${CERTIFICATE}`));

        make(api, { app, arch: 'x64' });
        expect(run.mock.calls[0][0].slice(0, 2)).toEqual(['sh', '-c']);
        expect(run.mock.calls[0][0][2]).toContain('keytool -list -rfc');
        expect(run.mock.calls[0][1]).toEqual({ cwd: api.workDir, isSigning: true });
        expect(textOf(readPackage(`${app}.msix`), 'AppxManifest.xml')).toContain('Publisher="CN=Buğra Sarı, ');
        expect(fs.readdirSync(api.workDir)).toEqual([]);
    });

    test('makes none where neither app.windows.msix nor app.installers asks for one', () => {
        const { api, app } = apiOf({ version: '1.2.3-beta.1' });
        expect(() => check(api)).not.toThrow();
        expect(make(api, { app, arch: 'x64' })).toEqual([]);
        expect(fs.existsSync(`${app}.msix`)).toBe(false);
    });

    test('stops a build whose package would be refused: a prerelease, no icon, no key for one handed out', () => {
        expect(() => check(apiOf({ app: { windows: { msix: STORE } }, version: '1.2.3-beta.1' }).api)).toThrow("crossbind: package.json's version \"1.2.3-beta.1\" is no version of an MSIX package");
        expect(() => check(apiOf({ app: { windows: { msix: STORE }, icon: undefined } }).api)).toThrow('logos made from app.icon');
        expect(() => check(apiOf({ app: { installers: ['msix'] } }).api)).toThrow('no CROSSBIND_WINDOWS_SIGNING_STORETYPE names');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_CERTFILE', '');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'AZUREKEYVAULT');
        expect(() => check(apiOf({ app: { installers: ['msix'] }, signer: '/host/jsign.sh' }).api)).toThrow('Set CROSSBIND_WINDOWS_SIGNING_CERTFILE to the certificate of the cloud');
    });

    test("versions a package by package.json's three numbers and a 0, which the Store keeps", () => {
        expect(msixVersion('1.2.3')).toBe('1.2.3.0');
        expect(msixVersion('0.0.0')).toBe('0.0.0.0');
        for (const version of ['1.2.3-beta.1', '1.2.3+build.5', '1.2', '1.2.3.4', '65536.0.0']) expect(() => msixVersion(version)).toThrow('is no version of an MSIX package');
    });

    test("takes the Store's identity whole from app.windows.msix", () => {
        const identity = (msixOptions) => storeIdentity({ config: { app: { windows: { msix: msixOptions } } } });
        expect(storeIdentity({ config: { app: {} } })).toBeNull();
        expect(identity(STORE)).toEqual(STORE);
        expect(() => identity({ ...STORE, publisherDisplayName: '' })).toThrow('app.windows.msix has no publisherDisplayName');
        expect(() => identity({ ...STORE, version: '1.0.0.0' })).toThrow('app.windows.msix takes name, publisher, publisherDisplayName; version is none of them.');
        expect(() => identity({ ...STORE, name: 'Demo App' })).toThrow('app.windows.msix.name "Demo App" is no name of an MSIX package');
        expect(() => identity('Demo')).toThrow('app.windows.msix "Demo" is no object');
    });
});
