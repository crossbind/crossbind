// What `-p host` builds: the platform whose binaries this machine runs. Node reports glibc and musl
// Linux alike; as the addon loader decides, a glibc process names its glibc in the report header.
export default function hostPlatform(platform = process.platform, readReport = processReport) {
    if (platform !== 'linux') return platform;
    const header = readReport()?.header;
    return !header || header.glibcVersionRuntime ? 'linux' : 'linuxmusl';
}

export const resolveHostPlatform = (platforms, host = hostPlatform()) => platforms.map((platform) => (platform === 'host' ? host : platform));

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
