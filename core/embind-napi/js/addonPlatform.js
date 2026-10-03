// The platform part of an addon file name. Node reports musl and glibc systems alike as 'linux'; a
// process linked against glibc names that glibc in its report header, a musl one does not.
export default function addonPlatform(platform = process.platform, readReport = processReport) {
    if (platform !== 'linux') return platform;
    const header = readReport()?.header;
    return !header || header.glibcVersionRuntime ? 'linux' : 'linuxmusl';
}

function processReport() {
    if (!process.report) return undefined;
    // Only the header is read; the network section can stall on DNS lookups.
    const { excludeNetwork } = process.report;
    process.report.excludeNetwork = true;
    try {
        return process.report.getReport();
    } finally {
        process.report.excludeNetwork = excludeNetwork;
    }
}
