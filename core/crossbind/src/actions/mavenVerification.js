// The verification metadata of an Android app whose extensions ask Maven for libraries: the android-app image's, which
// lists all crossbind's own project resolves, with each extension's components, as Gradle's
// --write-verification-metadata lists them. Gradle then checks every file it resolves, from the image's cache or online.

const COMPONENT = /<component group="([^"]+)" name="([^"]+)" version="([^"]+)"[^>]*>([\s\S]*?)<\/component>/g;
const ARTIFACT = /<artifact name="([^"]+)">[\s\S]*?<\/artifact>/g;
// What would leave a file unchecked, which an extension's metadata may not add to the app's.
const TRUST = /<(trusted-artifacts|trust|ignored-keys|trusted-keys)\b/;

export function mergedVerification(base, fragments) {
    const components = new Map();
    const add = (xml, owner) => {
        for (const [, group, name, version, body] of xml.matchAll(COMPONENT)) {
            const key = `${group}:${name}:${version}`;
            const artifacts = components.get(key) ?? new Map();
            for (const [block, artifact] of body.matchAll(ARTIFACT)) {
                const known = artifacts.get(artifact);
                if (known && known.block !== block) throw new Error(`crossbind: ${owner} gives ${artifact} of ${key} other checksums than ${known.owner} does.`);
                if (!known) artifacts.set(artifact, { block, owner });
            }
            components.set(key, artifacts);
        }
    };
    add(base, "the android-app image's verification metadata");
    for (const { name, xml } of fragments) {
        const owner = `the extension ${name}`;
        if (TRUST.test(xml)) throw new Error(`crossbind: ${owner}'s verification metadata trusts files Gradle would then leave unchecked, which no extension's may.`);
        if ([...xml.matchAll(COMPONENT)].length === 0) throw new Error(`crossbind: ${owner}'s verification metadata lists no component, as Gradle's --write-verification-metadata sha256 writes them.`);
        add(xml, owner);
    }
    const listed = [...components.entries()].sort(([one], [other]) => (one < other ? -1 : 1)).map(([key, artifacts]) => {
        const [group, name, version] = key.split(':');
        const blocks = [...artifacts.values()].map(({ block }) => `         ${block}\n`).join('');
        return `      <component group="${group}" name="${name}" version="${version}">\n${blocks}      </component>\n`;
    });
    return `${base.slice(0, base.indexOf('<components>'))}<components>\n${listed.join('')}   </components>\n</verification-metadata>\n`;
}
