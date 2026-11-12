import { Option } from 'commander';
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

// Adds to crossbind app the commands of an app's extensions, crossbind's own and those crossbind.config.js lists: a name
// another has stops the run, naming both.
export default function addExtensionCommands(parent, config = state.config) {
    if (!config?.target || !isAppProject(config)) return;
    const listed = config.extensions ?? [];
    const owners = new Map(parent.commands.map((command) => [command.name(), 'crossbind']));
    for (const { name: extension, commands = {} } of [...ownOf(listed, config.app), ...listed]) {
        for (const [name, command] of Object.entries(commands)) {
            if (owners.has(name)) throw new Error(`crossbind: ${extension} adds the command crossbind app ${name}, which ${owners.get(name)} has.`);
            owners.set(name, extension);
            const added = parent.command(name).description(command.help);
            Object.entries(command.options).forEach(([option, { help, value, default: fallback }]) => {
                const flag = new Option(`--${kebab(option)}${value ? ` ${value}` : ''}`, help);
                added.addOption(fallback === null ? flag : flag.default(fallback));
            });
            added.action((options) => extensionStep(extension, name, () => command.run(extensionApi(extension, { platform: null, options, isGuided: hasTerminal() }))));
        }
    }
}
