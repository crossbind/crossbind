import { networkOf } from './http.js';

const DEFAULT_LIMITS = Object.freeze({
    anonymousDaily: 5, userDaily: 100, globalDaily: 1000, buildSecondsMonthly: 3600, globalBuildHoursMonthly: 100, globalBuildHoursDaily: 10,
});
const HOUR_SECONDS = 3600;

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
    };
}
