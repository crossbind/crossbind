// What a process without its addon is told: install the addon package npm left out, learn that the package
// publishes none for this machine, or build the addon an app makes itself. published lists the
// <platform>-<arch> of every addon the package ships.
export default function missingAddonRemedy({ platform, arch, addonPackage, published }) {
    const target = `${platform}-${arch}`;
    if (!addonPackage) return `build it with \`crossbind build -p ${platform} -a ${arch}\``;
    if (!published.includes(target)) return `this package publishes no addon for ${target}, only for ${published.join(', ')}`;
    return `install ${addonPackage}, which npm leaves out with --omit=optional; addons exist for ${published.join(', ')}`;
}
