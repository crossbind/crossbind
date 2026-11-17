import { Option } from 'commander';
import appKeys from './appKeys.js';
import extensionApi from './extensionApi.js';
import state from '../state/index.js';
import { hasTerminal } from '../utils/ask.js';
import { extensionStep, ownExtensions, withoutNamed } from '../utils/appExtensions.js';
import { isAppProject } from '../utils/appProject.js';
import resolveAppHostRoot from '../utils/resolveAppHost.js';

const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// crossbind's own extensions a project has, none where its host is not installed, which each command that needs it says:
// the commands of those app.without leaves out, and of those whose role or name another takes, go with them.
function ownOf(listed, app) {
    let root;
    try {
        root = resolveAppHostRoot();
    } catch {
        return [];
    }
    const taken = new Set(listed.flatMap(({ name, replaces }) => [name, ...(replaces ?? [])]));
    return withoutNamed(ownExtensions(root), app).filter(({ name }) => !taken.has(name));
}

// Gives a command an extension adds its help, its options and the step it runs, which a failure names.
function addRunnable(added, extension, step, { help, options, run }) {
    added.description(help);
    Object.entries(options).forEach(([option, { help: line, value, default: fallback }]) => {
        const flag = new Option(`--${kebab(option)}${value ? ` ${value}` : ''}`, line);
        added.addOption(fallback === null ? flag : flag.default(fallback));
    });
    added.action((given) => extensionStep(extension, step, () => run(extensionApi(extension, { platform: null, options: given, isGuided: hasTerminal() }))));
}

// Adds to crossbind app the commands of an app's extensions, crossbind's own and those crossbind.config.js lists, and
// their keys to crossbind app key, which then says where each is kept: a name another has stops the run, naming both.
export default function addExtensionCommands(parent, config = state.config) {
    if (!config?.target || !isAppProject(config)) return;
    const listed = config.extensions ?? [];
    const owners = new Map(parent.commands.map((command) => [command.name(), 'crossbind']));
    const keyCommand = parent.commands.find((command) => command.name() === 'key');
    const keyOwners = new Map((keyCommand?.commands ?? []).map((command) => [command.name(), 'crossbind']));
    const keys = [];
    for (const { name: extension, commands = {}, keys: own = {} } of [...ownOf(listed, config.app), ...listed]) {
        for (const [name, command] of Object.entries(commands)) {
            if (owners.has(name)) throw new Error(`crossbind: ${extension} adds the command crossbind app ${name}, which ${owners.get(name)} has.`);
            owners.set(name, extension);
            addRunnable(parent.command(name), extension, name, command);
        }
        for (const [name, key] of Object.entries(keyCommand ? own : {})) {
            if (keyOwners.has(name)) throw new Error(`crossbind: ${extension} adds the key crossbind app key ${name}, which ${keyOwners.get(name)} has.`);
            keyOwners.set(name, extension);
            addRunnable(keyCommand.command(name), extension, `key ${name}`, key);
            keys.push({ extension, name, key });
        }
    }
    keyCommand?.action((name) => appKeys(name, keys));
}
