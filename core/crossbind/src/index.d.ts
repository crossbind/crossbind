// What crossbind() hands a tool: the plugin of the integration the tool's first use picks, whose hooks are the tool's.
// It is typed loosely, so that every tool's plugin type takes it without crossbind depending on any of them.
export interface CrossbindPlugin {
    name: string;
    apply(...args: any[]): any;
    [hook: string]: any;
}

// crossbind() in a tool's plugin list; crossbind(config) around the config of a tool that has none, which it gives back
// as the tool takes it, or a Promise of it.
declare function crossbind(): CrossbindPlugin;
declare function crossbind<Config extends object>(config: Config): Config | Promise<Config>;

export default crossbind;
