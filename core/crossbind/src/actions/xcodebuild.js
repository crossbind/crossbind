import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { EXEC_MAX_BUFFER } from './run.js';

const DEVELOPER_ACCOUNT = 'https://developer.apple.com/account';
// The lines of a failed xcodebuild's output that say why; its log has the rest.
const REASON_LINES = 15;

// What a failed build, archive or upload means where xcodebuild's own words leave it unclear: what the user mends in
// Xcode or on Apple's sites, and the page where. A cause may need another build, as one in what was built does.
const CAUSES = [
    {
        pattern: /login details for account .* were rejected|No Accounts?\b|No Account for Team/i,
        hint: ({ team }) => `Xcode is signed in to no account of team ${team}, or its sign-in has lapsed: sign in again in Xcode, under Settings › Accounts.`,
    },
    {
        pattern: /PLA Update available|Program License Agreement/i,
        hint: () => `Apple has a new Program License Agreement, which the team's Account Holder accepts at ${DEVELOPER_ACCOUNT}.`,
        page: DEVELOPER_ACCOUNT,
    },
    {
        pattern: /Cloud signing permission error/i,
        hint: () => "the API key may not sign in the cloud, which takes its Admin role: use an Admin key, make an Apple Distribution certificate once in Xcode, under Settings › Accounts › Manage Certificates, or unset CROSSBIND_APPLE_API_KEY to upload with Xcode's account.",
    },
    {
        pattern: /cannot be registered to your development team because it is not available/i,
        hint: ({ id }) => `another team registered the bundle id ${id} with Apple first: set app.id in crossbind.config.js to an id of your own, as one under a domain you own.`,
        // The id is in what was built, so the same step tried again fails the same way.
        needsRebuild: true,
    },
];

// Runs xcodebuild with its output in `log`, which it returns. Its failure names the lines that say why, and what to do
// where those leave it unclear, from crossbind's causes first, then those the caller adds: the error says whether the
// user can mend it and try again, the page where, and the cause it found.
export function xcodebuild(what, args, { log, facts = {}, causes = [] }) {
    const out = fs.openSync(log, 'w');
    let result;
    try {
        result = spawnSync('xcodebuild', args, { stdio: ['ignore', out, out] });
    } finally {
        fs.closeSync(out);
    }
    if (result.error) throw new Error(`crossbind: cannot run xcodebuild, which comes with Xcode: ${result.error.message}`, { cause: result.error });
    if (result.signal) throw new Error(`crossbind: ${what} stopped on ${result.signal}.`);
    const output = fs.readFileSync(log, 'utf8');
    if (result.status === 0) return output;
    const reasons = [...new Set(output.split('\n').map((line) => line.trim()).filter((line) => /\berror\b|ITMS-/i.test(line)))].slice(-REASON_LINES);
    const cause = [...CAUSES, ...causes].find(({ pattern }) => pattern.test(output));
    const lines = [`crossbind: ${what} failed; xcodebuild's log is ${log}.`, ...reasons.map((line) => `  ${line}`), ...(cause ? [`crossbind: ${cause.hint(facts)}`] : [])];
    throw Object.assign(new Error(lines.join('\n')), { isMendable: Boolean(cause) && !cause.needsRebuild, page: cause?.page ?? null, reason: cause ?? null });
}

// The teams of the accounts signed in to Xcode that upload to App Store Connect, which a free personal team does not,
// from Xcode's settings; `withPersonal` adds those free teams, which sign for their own devices.
export function xcodeTeams({ withPersonal = false } = {}) {
    const settings = spawnSync('defaults', ['export', 'com.apple.dt.Xcode', '-'], { maxBuffer: EXEC_MAX_BUFFER });
    if (settings.status !== 0) return [];
    const teams = spawnSync('plutil', ['-extract', 'IDEProvisioningTeamByIdentifier', 'json', '-o', '-', '-'], {
        input: settings.stdout, encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER,
    });
    if (teams.status !== 0) return [];
    const signing = Object.values(JSON.parse(teams.stdout)).flat().filter((team) => withPersonal || !team.isFreeProvisioningTeam);
    return [...new Map(signing.map((team) => [team.teamID, { id: team.teamID, name: team.teamName }])).values()];
}
