// Where a build keeps the notices of the runtime a toolchain image linked into its binaries,
// relative to the build directory; crossbind licenses reads them from there.
export default function toolchainNoticesDir(platform) {
    return `toolchain-licenses/${platform}`;
}
