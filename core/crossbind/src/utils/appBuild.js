import state from '../state/index.js';

// Whether this run builds an app: crossbind app says so to the bundler it starts, CROSSBIND_APP_PLATFORM names an app's
// platform, or the project is an app alone by target.runtimeEnv. Without any of these a bundler plugin builds what a
// browser loads, so one project makes both by the command that builds it.
export default function isAppBuild(env = process.env) {
    return env.CROSSBIND_APP_BUILD === '1' || Boolean(env.CROSSBIND_APP_PLATFORM) || state.config.target?.runtimeEnv === 'app';
}
