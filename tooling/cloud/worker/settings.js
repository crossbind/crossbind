import { networkOf } from './http.js';

const DEFAULT_LIMITS = Object.freeze({
    anonymousDaily: 5, userDaily: 100, newAccountDaily: 20, globalDaily: 1000, buildSecondsMonthly: 3600, globalBuildHoursMonthly: 100, globalBuildHoursDaily: 10, snapshotsTotalGb: 20,
    snapshotUploadsDaily: 50, globalSnapshotUploadsDaily: 1000,
});
const HOUR_SECONDS = 3600;
const GB = 1024 ** 3;

const list = (value) => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
// A blank or non-numeric value counts as unset, so a var left empty never turns a limit into 0.
export const numberOr = (value, fallback) => (value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback);

// The vars of wrangler.jsonc.
export function settingsOf(env) {
    return {
        enabled: env.PLAYGROUND_ENABLED === 'true',
        origins: list(env.ALLOWED_ORIGINS),
        anonymousDaily: numberOr(env.ANONYMOUS_DAILY, DEFAULT_LIMITS.anonymousDaily),
        userDaily: numberOr(env.USER_DAILY, DEFAULT_LIMITS.userDaily),
        // An account in its first days with no GitHub account linked (worker/accounts.js buildsOpenOn).
        newAccountDaily: numberOr(env.NEW_ACCOUNT_DAILY, DEFAULT_LIMITS.newAccountDaily),
        globalDaily: numberOr(env.GLOBAL_DAILY, DEFAULT_LIMITS.globalDaily),
        cloudBuildsEnabled: env.CLOUD_BUILDS_ENABLED === 'true',
        buildSecondsMonthly: numberOr(env.BUILD_SECONDS_MONTHLY, DEFAULT_LIMITS.buildSecondsMonthly),
        // What a month of cloud builds may cost at most, for everyone together, and how much of it a day may spend.
        globalBuildSeconds: numberOr(env.GLOBAL_BUILD_HOURS_MONTHLY, DEFAULT_LIMITS.globalBuildHoursMonthly) * HOUR_SECONDS,
        globalDailySeconds: numberOr(env.GLOBAL_BUILD_HOURS_DAILY, DEFAULT_LIMITS.globalBuildHoursDaily) * HOUR_SECONDS,
        // Networks that may not compile without signing in: IPv4 addresses, and IPv6 addresses for their /64.
        blockedNetworks: new Set(list(env.BLOCKED_NETWORKS).map(networkOf)),
        turnstileHostnames: list(env.TURNSTILE_HOSTNAMES),
        compilerVersion: env.COMPILER_VERSION ?? '',
        // Snapshots (worker/snapshots.js): their switch, the host that serves them, what they hold together at most, and
        // the uploads a day of an account and of everyone, as R2 bills each file an upload writes.
        snapshotsEnabled: env.SNAPSHOTS_ENABLED === 'true',
        snapshotsHost: env.SNAPSHOTS_HOST ?? '',
        snapshotsTotalBytes: numberOr(env.SNAPSHOTS_TOTAL_GB, DEFAULT_LIMITS.snapshotsTotalGb) * GB,
        snapshotUploadsDaily: numberOr(env.SNAPSHOT_UPLOADS_DAILY, DEFAULT_LIMITS.snapshotUploadsDaily),
        globalSnapshotUploadsDaily: numberOr(env.GLOBAL_SNAPSHOT_UPLOADS_DAILY, DEFAULT_LIMITS.globalSnapshotUploadsDaily),
    };
}
