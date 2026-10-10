import { cloudCredentials, cloudUrl } from './cloudAccount.js';
import logger from './logger.js';
import systemKeys, { assertRunner } from './systemKeys.js';

const RUNNER_VARIABLE = 'CROSSBIND_RUNNER';
const SYSTEM_CONFIG = '~/.crossbind.json';
const SHARED = { key: 'REMOTE_URL', url: 'CROSSBIND_REMOTE_URL', token: 'CROSSBIND_TOKEN' };

export const remoteVariables = (role) => {
    const suffix = `_${role.toUpperCase()}`;
    return { key: `${SHARED.key}${suffix}`, url: `${SHARED.url}${suffix}`, token: `${SHARED.token}${suffix}` };
};

// Unchecked, so commands that run no step still work with an invalid RUNNER, `crossbind config set` among them.
function runnerSetting(system, env) {
    if (env[RUNNER_VARIABLE]) return { runner: env[RUNNER_VARIABLE], name: RUNNER_VARIABLE };
    return { runner: system?.RUNNER ?? systemKeys.RUNNER.default, name: `RUNNER in ${SYSTEM_CONFIG}` };
}

export function chosenRunner(system, env = process.env) {
    const { runner, name } = runnerSetting(system, env);
    return assertRunner(runner, name);
}

export const isLocalRunner = (system, env = process.env) => runnerSetting(system, env).runner === 'LOCAL';

// A variable wins over the same key in the system config, and an image's own address over the shared one.
// A token goes only to the address it is paired with, so a shared token never reaches the runner of one image.
function remoteAddress(role, system, env) {
    for (const names of [remoteVariables(role), SHARED]) {
        const url = env[names.url] || system?.[names.key];
        if (url) {
            const from = env[names.url] ? `$${names.url}` : `${names.key} in ${SYSTEM_CONFIG}`;
            if (!['http:', 'https:'].includes(URL.parse(url)?.protocol)) {
                throw new Error(`crossbind: ${from} is ${JSON.stringify(url)}, not an http or https address.`);
            }
            return {
                url, from, token: env[names.token], tokenVariable: names.token,
            };
        }
    }
    return null;
}

const announced = new Set();

// Each image says once which runner its steps go to and which settings sent them there.
function announce(role, remote, env) {
    const key = `${role} ${remote.url}`;
    if (announced.has(key)) return;
    announced.add(key);
    const chosenBy = env[RUNNER_VARIABLE] ? `$${RUNNER_VARIABLE}` : SYSTEM_CONFIG;
    const shown = remote.url.replace(/\/\/[^/]*@/, '//');
    logger.info(`crossbind: ${role} steps run on the runner at ${shown} (RUNNER=REMOTE from ${chosenBy}, address from ${remote.from}).`);
}

// A runner address named anywhere, for any image, keeps every image off the cloud: the sources go only where the
// user sends them.
const namesOwnRunner = (system, env) => Object.keys(systemKeys).some((key) => key.startsWith(SHARED.key) && system?.[key])
    || Object.keys(env).some((name) => name.startsWith(SHARED.url) && env[name]);

// The sign-in of `crossbind login` carries its own token; a token set for runners never reaches the cloud.
function cloudAddress(role, system, env) {
    const url = cloudUrl(system, env);
    const signedIn = cloudCredentials(url);
    if (!signedIn) return null;
    return {
        url: `${url}/runner/${role}`, from: `crossbind login as ${signedIn.login}`, token: signedIn.token, tokenVariable: null,
    };
}

// Under REMOTE, an image runs on its own address, else the shared one; a machine that names no runner address at all
// runs on crossbind cloud once signed in. Without any it gets no runner: its steps stop instead of running in the
// local Docker, where the build would only seem to run on a runner.
export function runnerFor(role, system, env = process.env) {
    const runner = chosenRunner(system, env);
    if (runner !== 'REMOTE') return { runner };
    const remote = remoteAddress(role, system, env) ?? (namesOwnRunner(system, env) ? null : cloudAddress(role, system, env));
    if (remote) announce(role, remote, env);
    return { runner, remote };
}
