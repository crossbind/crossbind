// The slice of a package's <name>.xcframework that an iOS target links: crossbind's packages carry arm64 alone.
const SLICES = { iphoneos: 'ios-arm64', iphonesimulator: 'ios-arm64-simulator' };

export default function xcframeworkSliceOf(projectPath, name, target) {
    return `${projectPath}/${name}.xcframework/${SLICES[target.arch]}`;
}
