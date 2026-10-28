import { PLAY_SCOPE, keepSignIn } from './googlePlay.js';
import { signIn } from './googleSignIn.js';
import { askYesNo } from '../utils/ask.js';

// Signs the user in to Google Play with their Google account, in their browser, once they say yes to question, and keeps
// the sign-in in the system's keychain for later publishes. Google's page lets the user leave Play's access out, so the
// sign-in is asked for again until it has it, or is null once the user says no.
export async function signInToPlay(question) {
    let asked = question;
    while (await askYesNo(asked)) {
        const { refresh_token: refreshToken, scope = '' } = await signIn(PLAY_SCOPE);
        if (scope.split(' ').includes(PLAY_SCOPE)) {
            if (!keepSignIn(refreshToken)) console.log('crossbind: this machine has no keychain to keep the sign-in in, so the next publish signs in again.');
            return { refreshToken };
        }
        asked = "The sign-in left Google Play's access out, its box on Google's page. Sign in again? [Y/n] ";
    }
    return null;
}
