import fs from 'node:fs';
import { Command, Option } from 'commander';

import {
    deleteAccount as deleteCloudAccount, fetchUsage, login as loginToCloud, logout as logoutOfCloud, usageLines,
} from './actions/cloudCommands.js';
import { cloudUrl } from './utils/cloudAccount.js';
import flattenConfigForTable from './utils/flattenConfigForTable.js';
import loadSystemConfig, { systemConfigPath } from './utils/systemConfig.js';
import systemKeys from './utils/systemKeys.js';
import writeJson from './utils/writeJson.js';

const packageJSON = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));

// Build failures bubble up as exceptions with a `cause` chain (see actions/run.js);
// show the operator a single line — DEBUG=1 for the full stack — and exit non-zero.
export const handleFatal = (e) => {
    if (process.env.DEBUG) {
        console.error(e);
    } else {
        let message = e?.message || String(e);
        if (e?.cause?.message) message += `\n  caused by: ${e.cause.message.split('\n')[0]}`;
        console.error(message);
    }
    // Writes to a pipe are asynchronous, so exiting at once would cut what is still queued, such as the failed
    // command's output run.js printed: exit after both streams have written it.
    process.stdout.write('', () => process.stderr.write('', () => process.exit(1)));
};

export const createProgram = () => new Command()
    .name('crossbind')
    .description('Compile C++ files to WebAssembly and native platforms.')
    .version(packageJSON.version)
    .showHelpAfterError();

export function addSystemCommands(program) {
    program.command('login')
        .description('sign in to crossbind cloud with your GitHub account')
        .action(async () => {
            const url = cloudUrl(loadSystemConfig());
            const { login } = await loginToCloud({ url });
            console.log(`crossbind: signed in to ${url} as ${login}.`);
        });

    program.command('logout')
        .description('sign out of crossbind cloud on this machine')
        .option('--all', 'sign out every machine signed in to this account')
        .action(async (options) => {
            const url = cloudUrl(loadSystemConfig());
            const result = await logoutOfCloud({ url, all: Boolean(options.all) });
            if (!result) {
                console.log(`crossbind: not signed in to ${url}.`);
            } else if (result.revoked) {
                console.log(`crossbind: signed ${result.login} out${options.all ? ' on every machine' : ''}.`);
            } else {
                console.warn(`crossbind: signed out here, but crossbind cloud did not revoke the token (${result.reason.replace(/^crossbind: /, '')}). Sign in again and run crossbind logout --all to revoke it.`);
            }
        });

    program.command('usage')
        .description('show what you used of crossbind cloud this month and what is left')
        .action(async () => {
            usageLines(await fetchUsage({ url: cloudUrl(loadSystemConfig()) })).forEach((line) => console.log(line));
        });

    program.command('account')
        .description('manage your crossbind cloud account')
        .command('delete')
        .description('delete your crossbind cloud account, with the sign-in of every machine (https://crossbind.dev/privacy/)')
        .option('--yes', 'delete it; without this, nothing is deleted')
        .action(async (options) => {
            const url = cloudUrl(loadSystemConfig());
            if (!options.yes) {
                throw new Error(`crossbind: this deletes your crossbind cloud account at ${url}, with the sign-in of every machine. Run crossbind account delete --yes to go ahead.`);
            }
            const { login } = await deleteCloudAccount({ url });
            console.log(`crossbind: deleted the crossbind cloud account of ${login}.`);
        });

    const commandConfig = program.command('config')
        .description('manage the crossbind configuration files');

    commandConfig.command('get')
        .description('get the crossbind system configuration')
        .argument('<key>', 'configuration key to read')
        .action((key) => getSystemConfig(key));

    commandConfig.command('set')
        .description('set the crossbind system configuration')
        .argument('<key>', 'configuration key to set')
        .argument('<value>', 'value to assign')
        .action((key, value) => setSystemConfig(key, value));

    commandConfig.command('delete')
        .description('delete the crossbind system configuration')
        .argument('<key>', 'configuration key to remove')
        .action((key) => deleteSystemConfig(key));

    commandConfig.command('list')
        .description('list the crossbind configurations')
        .addOption(new Option('-t, --type <type>', 'config type').default('system').choices(['all', 'system', 'project']))
        .action((options) => listSystemConfig(options.type));

    commandConfig.command('keys')
        .description('list all available system configuration keys for crossbind')
        .action(() => listSystemKeys());
}

function listSystemKeys() {
    console.info('Available configurations:');
    console.table(systemKeys);
}

async function getSystemConfig(systemKey) {
    if (!systemKey) {
        await listSystemConfig('system');
        return;
    }
    const system = loadSystemConfig();
    const key = systemKey.toUpperCase();
    const output = {};
    if (key in system) {
        output[key] = { value: system[key] || 'undefined', default: systemKeys[key].default };
    }
    Object.keys(systemKeys).filter((k) => k.includes(key)).forEach((k) => {
        if (k in system) {
            output[k] = { value: system[k] || 'undefined', default: systemKeys[k].default };
        }
    });

    console.table(output);
}

function setSystemConfig(key, value) {
    if (!systemKeys[key]) {
        throw new Error(`Configuration ${key} is not available. Please choose from the following available configurations: ${Object.keys(systemKeys).join(', ')}`);
    }
    if (systemKeys[key].options && !systemKeys[key].options.includes(value)) {
        throw new Error(`Value ${value} is not available. Please choose from the following available values: ${systemKeys[key].options.join(', ')}`);
    }

    writeJson(systemConfigPath(), { ...loadSystemConfig(), [key]: value });
}

function deleteSystemConfig(key) {
    if (!systemKeys[key]) {
        throw new Error(`Configuration ${key} is not available. Please choose from the following available configurations: ${Object.keys(systemKeys).join(', ')}`);
    }
    const { [key]: deleted, ...system } = loadSystemConfig();
    writeJson(systemConfigPath(), system);
}

async function listSystemConfig(type) {
    // Importing the state loads the project, which fails outside one, so only a listing of the project does.
    const { system: systemConfig, ...projectConfig } = type === 'system'
        ? { system: loadSystemConfig() }
        : (await import('./state/index.js')).default.config;
    if (type === 'all' || type === 'system') {
        console.log('System Configuration');
        console.table(systemConfig);
    }

    if (type === 'all') {
        console.log('');
    }

    if (type === 'all' || type === 'project') {
        console.log(`Project Configuration (paths relative to ${projectConfig.paths.base})`);
        console.table(flattenConfigForTable(projectConfig, { base: projectConfig.paths.base }));
    }
}
