import { beforeEach, describe, expect, test, vi } from 'vitest';

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
// Google's sign-in page, which grants each sign-in the scope `granted` names in the browser the api opens, and the
// keychain, which keeps a sign-in unless the machine has none.
const google = {};
vi.mock('../src/publishers/google-play/googleSignIn.js', () => ({
    signIn: async (scope, openUrl) => {
        google.scopes.push(scope);
        google.opener = openUrl;
        return { access_token: 'access', refresh_token: `refresh-${google.scopes.length}`, scope: google.granted.shift() };
    },
}));
vi.mock('../src/publishers/google-play/googlePlay.js', () => ({
    PLAY_SCOPE: SCOPE,
    keepSignIn: (secrets, refreshToken) => {
        google.kept.push(refreshToken);
        return google.hasKeychain;
    },
}));
const answers = {};
let printed;
const api = {
    askYesNo: async (question) => {
        answers.questions.push(question);
        return answers.yes.shift() ?? true;
    },
    openUrl: () => {},
    secrets: {},
    log: (line) => printed.push(line),
};

const { signInToPlay } = await import('../src/publishers/google-play/playSetup.js');

beforeEach(() => {
    Object.assign(google, { scopes: [], granted: [], kept: [], hasKeychain: true, opener: null });
    Object.assign(answers, { questions: [], yes: [] });
    printed = [];
});

describe('the Google sign-in Google Play takes uploads with', () => {
    test('is made in the browser once the user says yes, for Play alone, and kept in the keychain', async () => {
        google.granted = [SCOPE];
        expect(await signInToPlay(api, 'Sign in now? [Y/n] ')).toEqual({ refreshToken: 'refresh-1' });
        expect(answers.questions).toEqual(['Sign in now? [Y/n] ']);
        expect(google.scopes).toEqual([SCOPE]);
        expect(google.kept).toEqual(['refresh-1']);
        expect(google.opener).toBe(api.openUrl);
        expect(printed).toEqual([]);
    });

    test("is asked for again while it leaves Play's access out, and is none once the user says no", async () => {
        google.granted = ['', SCOPE];
        expect(await signInToPlay(api, 'Sign in now? [Y/n] ')).toEqual({ refreshToken: 'refresh-2' });
        expect(answers.questions[1]).toContain("The sign-in left Google Play's access out");
        expect(google.kept).toEqual(['refresh-2']);

        answers.yes = [false];
        expect(await signInToPlay(api, 'Sign in now? [Y/n] ')).toBeNull();
        expect(google.scopes).toHaveLength(2);
    });

    test('is made again at the next publish where the machine has no keychain', async () => {
        google.granted = [SCOPE];
        google.hasKeychain = false;
        expect(await signInToPlay(api, 'Sign in now? [Y/n] ')).toEqual({ refreshToken: 'refresh-1' });
        expect(printed).toEqual(['crossbind: this machine has no keychain to keep the sign-in in, so the next publish signs in again.']);
    });
});
