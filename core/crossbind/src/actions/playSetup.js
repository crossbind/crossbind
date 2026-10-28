import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLAY, playCredentials } from './googlePlay.js';
import { updateSystemConfig } from '../utils/systemConfig.js';
import { askLine, askYesNo } from '../utils/ask.js';

const ACCOUNT_NAME = 'crossbind-play';

// What gcloud is set to, or '' where there is no gcloud or no such setting.
function gcloudSetting(name) {
    const result = spawnSync('gcloud', ['config', 'get-value', name], { encoding: 'utf8' });
    return result.error || result.status !== 0 ? '' : result.stdout.trim();
}

function gcloud(what, args) {
    const result = spawnSync('gcloud', args, { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
        throw new Error(`crossbind: gcloud ${what} failed; app.md's Publishing says how to set the service account up by hand.`);
    }
}

// Sets up the service account Google Play takes uploads from, once the user says yes: through gcloud where it is signed
// in, whose login then gets the account's tokens so no key of it exists, else from a JSON key the user names. This
// machine keeps it in ~/.crossbind.json.
export async function setUpPlayAccount() {
    const user = gcloudSetting('account');
    const project = user && gcloudSetting('project');
    const question = `Google Play takes uploads from a service account. Make one in your Google Cloud project ${project}, whose tokens your gcloud login, ${user}, gets, so no key of it exists? [Y/n] `;
    if (project && await askYesNo(question)) {
        const account = `${ACCOUNT_NAME}@${project}.iam.gserviceaccount.com`;
        gcloud('services enable', ['services', 'enable', 'androidpublisher.googleapis.com', 'iamcredentials.googleapis.com', '--project', project]);
        if (spawnSync('gcloud', ['iam', 'service-accounts', 'describe', account, '--project', project], { stdio: 'ignore' }).status !== 0) {
            gcloud('iam service-accounts create', ['iam', 'service-accounts', 'create', ACCOUNT_NAME, '--display-name', 'crossbind app publish', '--project', project]);
        }
        const member = user.endsWith('.gserviceaccount.com') ? `serviceAccount:${user}` : `user:${user}`;
        gcloud('iam service-accounts add-iam-policy-binding', ['iam', 'service-accounts', 'add-iam-policy-binding', account, '--member', member,
            '--role', 'roles/iam.serviceAccountTokenCreator', '--project', project]);
        updateSystemConfig({ GOOGLE_PLAY_SERVICE_ACCOUNT: account });
        console.log(`crossbind: Google Play's service account is ${account}.`);
        return { account };
    }
    const file = path.resolve((await askLine("Google Play takes uploads from a service account. The path of its JSON key, which app.md's Publishing says how to make: ")).trim());
    const credentials = playCredentials({ [PLAY.key]: file }, {});
    updateSystemConfig({ GOOGLE_PLAY_KEY: file });
    return credentials;
}
