import fs from 'node:fs';
import path from 'node:path';

const APP_HOST = '@crossbind/core-app-host';

function listsAppHost(project) {
    const manifest = path.join(project, 'package.json');
    if (!fs.existsSync(manifest)) return false;
    const { dependencies, devDependencies } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return Boolean(dependencies?.[APP_HOST] ?? devDependencies?.[APP_HOST]);
}

// A project an app builds from: one that says it is an app, or that has the app host and leaves its environment to the
// command that builds it.
export const isAppProject = ({ target, paths }) => target?.runtimeEnv === 'app' || (!target?.runtimeEnv && listsAppHost(paths.project));

// Stops what only an app does, in a project that is none, saying what would make it one.
export function assertAppProject(config, doing) {
    if (isAppProject(config)) return;
    const { runtimeEnv } = config.target;
    throw new Error(runtimeEnv
        ? `crossbind: ${doing}, and this project's target.runtimeEnv says ${runtimeEnv}: leave it out, or set it to 'app'.`
        : `crossbind: ${doing}, which this project is not: add ${APP_HOST} to its devDependencies, as the desktop-app template does.`);
}
