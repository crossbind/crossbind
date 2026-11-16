import path from 'node:path';
import { LOGOS, appxManifest } from './src/manifest.js';
import { filesIn, writeMsix } from './src/pack.js';
import { commonName, signingCertificate, windowsPublisher } from './src/publisher.js';

const MAX_VERSION_NUMBER = 65535;
// The name of an MSIX package: the one Partner Center reserves for the app, or the app's id.
const PACKAGE_NAME = /^[-.A-Za-z0-9]{3,50}$/;
const IDENTITY = ['name', 'publisher', 'publisherDisplayName'];
const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

// The version of the app's package: package.json's three numbers and a 0, the fourth number, which the Store keeps for
// itself. The Store takes only a version above the last it has, which a prerelease cannot be told by.
export function msixVersion(version) {
    const numbers = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
    if (!numbers || numbers.some((number) => number > MAX_VERSION_NUMBER)) {
        throw new Error(`crossbind: package.json's version ${JSON.stringify(version)} is no version of an MSIX package, which is three numbers from 0 to ${MAX_VERSION_NUMBER}, as 1.2.3 is: the Store cannot tell a prerelease, as 1.2.3-beta.1, from its release, and refuses the second.`);
    }
    return `${numbers.join('.')}.0`;
}

// app.windows.msix: the identity Partner Center's Product identity page gives the app, which its package for the Store
// carries as it is, or null.
export function storeIdentity(api) {
    const identity = api.config.app.windows?.msix;
    if (identity === undefined) return null;
    if (!isPlainObject(identity)) {
        throw new Error(`crossbind: app.windows.msix ${JSON.stringify(identity)} is no object of ${IDENTITY.join(', ')}, which Partner Center's Product identity page gives.`);
    }
    const unknown = Object.keys(identity).filter((key) => !IDENTITY.includes(key));
    if (unknown.length > 0) throw new Error(`crossbind: app.windows.msix takes ${IDENTITY.join(', ')}; ${unknown.join(', ')} is none of them.`);
    const missing = IDENTITY.filter((key) => typeof identity[key] !== 'string' || !identity[key].trim());
    if (missing.length > 0) {
        throw new Error(`crossbind: app.windows.msix has no ${missing.join(' or ')}, which Partner Center's Product identity page gives as Package/Identity/Name, Package/Identity/Publisher and Package/Properties/PublisherDisplayName.`);
    }
    return { name: packageName(identity.name, 'app.windows.msix.name'), publisher: identity.publisher, publisherDisplayName: identity.publisherDisplayName };
}

function packageName(name, where) {
    if (!PACKAGE_NAME.test(name)) throw new Error(`crossbind: ${where} ${JSON.stringify(name)} is no name of an MSIX package, which is 3 to 50 letters, digits, dots and hyphens.`);
    return name;
}

// The package's identity: the Store's, for a package the Store signs; or for one handed out, which the key that signs the
// app signs, the app's id and the subject of that key's certificate, which Windows holds the package's publisher to.
function identityOf(api) {
    const store = storeIdentity(api);
    if (store) return { ...store, isSigned: false };
    if (!api.windows.signer) {
        throw new Error("crossbind: an MSIX package the Store does not sign is signed with the app's key, which no CROSSBIND_WINDOWS_SIGNING_STORETYPE names, so Windows would install none: set the key, or give the Store's identity in app.windows.msix.");
    }
    const { subject } = signingCertificate(api);
    return { name: packageName(api.app.id, "the app's id"), publisher: windowsPublisher(subject), publisherDisplayName: commonName(subject), isSigned: true };
}

// A build makes the app's package for the Store with app.windows.msix, and one handed out where app.installers names
// msix.
const isWanted = (api) => api.config.app.windows?.msix !== undefined || (api.config.app.installers ?? []).includes('msix');

// crossbind's installer of a Windows app as an MSIX package beside its folder, which the Microsoft Store takes, signs and
// updates, or which its developer hands out signed with the app's key. Windows starts the app from it with the package's
// identity, through its alias as well, and registers its URL schemes and file types.
export default function msix() {
    return {
        name: 'msix',
        contract: 1,
        root: import.meta.dirname,
        reads: ['windows.msix'],
        installer: {
            platform: 'windows',
            check(api) {
                if (!isWanted(api)) return;
                msixVersion(api.app.version);
                identityOf(api);
                if (api.config.app.icon === undefined) throw new Error('crossbind: an MSIX package shows the app by logos made from app.icon, which crossbind.config.js does not give.');
            },
            make(api, { app, arch }) {
                if (!isWanted(api)) return [];
                const identity = identityOf(api);
                const executable = `${api.project.name}.exe`;
                const manifest = appxManifest({
                    identity: { name: identity.name, publisher: identity.publisher, version: msixVersion(api.app.version), arch },
                    displayName: api.app.name,
                    publisherDisplayName: identity.publisherDisplayName,
                    description: api.project.package?.description || api.app.name,
                    executable,
                    urlSchemes: api.app.urlSchemes,
                    fileTypes: api.app.fileTypes,
                    alias: executable,
                });
                const logos = Object.values(LOGOS).map(({ file, size }) => ({ name: file, data: api.windows.logo(size) }));
                const output = `${app}.msix`;
                writeMsix({ files: [...filesIn(app), ...logos], manifest }, output);
                if (identity.isSigned) api.run(['sh', api.windows.signer, path.basename(output)], { cwd: path.dirname(output), isSigning: true });
                return [output];
            },
        },
    };
}
