import {
    describe, test, expect, vi, beforeEach,
} from 'vitest';

vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn() } }));

async function importFresh() {
    vi.resetModules();
    const logger = (await import('../src/utils/logger.js')).default;
    logger.info.mockClear();
    const mod = await import('../src/utils/selectRunner.js');
    return { ...mod, info: logger.info };
}

let chosenRunner;
let runnerFor;

beforeEach(async () => {
    ({ chosenRunner, runnerFor } = await importFresh());
});

describe('chosenRunner', () => {
    test('is DOCKER_RUN when nothing names another', () => {
        expect(chosenRunner({}, {})).toBe('DOCKER_RUN');
        expect(chosenRunner(undefined, {})).toBe('DOCKER_RUN');
    });

    test('takes RUNNER from ~/.crossbind.json', () => {
        expect(chosenRunner({ RUNNER: 'REMOTE' }, {})).toBe('REMOTE');
    });

    test('lets CROSSBIND_RUNNER override the file, for CI and one-off builds; an empty one sets nothing', () => {
        expect(chosenRunner({ RUNNER: 'DOCKER_RUN' }, { CROSSBIND_RUNNER: 'LOCAL' })).toBe('LOCAL');
        expect(chosenRunner({ RUNNER: 'DOCKER_EXEC' }, { CROSSBIND_RUNNER: '' })).toBe('DOCKER_EXEC');
    });

    test('refuses a value that is no runner, naming the setting it came from', () => {
        expect(() => chosenRunner({}, { CROSSBIND_RUNNER: 'docker' })).toThrow(/the runner docker is invalid; CROSSBIND_RUNNER is one of DOCKER_RUN, DOCKER_EXEC, LOCAL, REMOTE/);
        expect(() => chosenRunner({ RUNNER: 'remote' }, {})).toThrow(/the runner remote is invalid; RUNNER in ~\/\.crossbind\.json is one of/);
        expect(() => chosenRunner({ RUNNER: '' }, {})).toThrow(/the runner {2}is invalid/);
    });
});

describe('runnerFor', () => {
    test('ignores every runner address unless RUNNER is REMOTE', () => {
        const env = { CROSSBIND_REMOTE_URL_WEB: 'https://web.example', CROSSBIND_TOKEN_WEB: 'web-token', CROSSBIND_REMOTE_URL: 'https://all.example' };
        const system = { REMOTE_URL_WEB: 'https://file.example' };

        expect(runnerFor('web', system, env)).toEqual({ runner: 'DOCKER_RUN' });
        expect(runnerFor('web', { ...system, RUNNER: 'DOCKER_EXEC' }, env)).toEqual({ runner: 'DOCKER_EXEC' });
        expect(runnerFor('web', { ...system, RUNNER: 'LOCAL' }, env)).toEqual({ runner: 'LOCAL' });
    });

    test('sends an image to its runner under REMOTE, with the token paired with that address', () => {
        const system = { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'https://web.example' };

        expect(runnerFor('web', system, { CROSSBIND_TOKEN_WEB: 'web-token', CROSSBIND_TOKEN: 'shared-token' })).toEqual({
            runner: 'REMOTE',
            remote: {
                url: 'https://web.example', from: 'REMOTE_URL_WEB in ~/.crossbind.json', token: 'web-token', tokenVariable: 'CROSSBIND_TOKEN_WEB',
            },
        });
    });

    test('lets an address variable override the same key in the file', () => {
        const system = { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'https://file.example' };

        expect(runnerFor('web', system, { CROSSBIND_REMOTE_URL_WEB: 'https://env.example' }).remote)
            .toMatchObject({ url: 'https://env.example', from: '$CROSSBIND_REMOTE_URL_WEB' });
    });

    test('prefers the address of the step\'s own image over the shared one, wherever each is set', () => {
        const system = { RUNNER: 'REMOTE', REMOTE_URL_LINUX: 'https://linux.example' };
        const env = { CROSSBIND_REMOTE_URL: 'https://shared.example', CROSSBIND_TOKEN: 'shared-token', CROSSBIND_TOKEN_LINUX: 'linux-token' };

        expect(runnerFor('linux', system, env).remote).toMatchObject({ url: 'https://linux.example', token: 'linux-token' });
        expect(runnerFor('web', system, env).remote).toMatchObject({ url: 'https://shared.example', token: 'shared-token', tokenVariable: 'CROSSBIND_TOKEN' });
    });

    test('never hands a shared token to the runner of one image', () => {
        const system = { RUNNER: 'REMOTE', REMOTE_URL_LINUX: 'https://linux.example' };

        expect(runnerFor('linux', system, { CROSSBIND_TOKEN: 'shared-token' }).remote)
            .toMatchObject({ token: undefined, tokenVariable: 'CROSSBIND_TOKEN_LINUX' });
    });

    test('gives an image without an address no runner rather than the local Docker', () => {
        const system = { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'https://web.example' };

        expect(runnerFor('android', system, {})).toEqual({ runner: 'REMOTE', remote: null });
    });

    test('refuses an address that is not http or https, naming the setting', () => {
        expect(() => runnerFor('web', { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'runner.example:8787' }, {}))
            .toThrow(/REMOTE_URL_WEB in ~\/\.crossbind\.json is "runner\.example:8787", not an http or https address/);
        expect(() => runnerFor('web', { RUNNER: 'REMOTE' }, { CROSSBIND_REMOTE_URL: 'not an address' }))
            .toThrow(/\$CROSSBIND_REMOTE_URL is "not an address"/);
    });
});

describe('what a REMOTE choice says', () => {
    test('names once per image the runner its steps go to and the settings that chose it', async () => {
        const { runnerFor: fresh, info } = await importFresh();
        const system = { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'https://web.example' };

        fresh('web', system, { CROSSBIND_TOKEN_WEB: 't' });
        fresh('web', system, { CROSSBIND_TOKEN_WEB: 't' });

        expect(info).toHaveBeenCalledTimes(1);
        expect(info.mock.calls[0][0]).toBe('crossbind: web steps run on the runner at https://web.example (RUNNER=REMOTE from ~/.crossbind.json, address from REMOTE_URL_WEB in ~/.crossbind.json).');
    });

    test('names $CROSSBIND_RUNNER when the environment chose REMOTE', async () => {
        const { runnerFor: fresh, info } = await importFresh();

        fresh('web', { RUNNER: 'DOCKER_RUN' }, { CROSSBIND_RUNNER: 'REMOTE', CROSSBIND_REMOTE_URL_WEB: 'https://web.example' });

        expect(info.mock.calls[0][0]).toBe('crossbind: web steps run on the runner at https://web.example (RUNNER=REMOTE from $CROSSBIND_RUNNER, address from $CROSSBIND_REMOTE_URL_WEB).');
    });

    test('keeps credentials written into an address out of the log', async () => {
        const { runnerFor: fresh, info } = await importFresh();

        fresh('web', { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'https://builder:secret-password@web.example:8443/runner' }, {});

        expect(info.mock.calls[0][0]).toContain('on the runner at https://web.example:8443/runner (');
        expect(info.mock.calls[0][0]).not.toContain('secret-password');
    });

    test('says nothing for an image without an address, whose steps stop instead', async () => {
        const { runnerFor: fresh, info } = await importFresh();

        fresh('android', { RUNNER: 'REMOTE' }, {});

        expect(info).not.toHaveBeenCalled();
    });

    test('stays quiet for the runners that keep every step on this machine', async () => {
        const { runnerFor: fresh, info } = await importFresh();

        ['DOCKER_RUN', 'DOCKER_EXEC', 'LOCAL'].forEach((RUNNER) => fresh('web', { RUNNER, REMOTE_URL_WEB: 'https://web.example' }, {}));

        expect(info).not.toHaveBeenCalled();
    });
});
