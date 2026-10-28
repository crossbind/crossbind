// <crossbind/app.h>, which an app's own code includes for the host's functions (docs/api/app.md).

import fs from 'node:fs';
import state from '../state/index.js';
import resolveAppHostRoot from './resolveAppHost.js';
import { runtimeEnvsOf } from './targets.js';

// An app project's native code compiles against the header, with CROSSBIND_APP defined, on every platform an app runs
// on, and in every flavour of that platform's archives, which share one build. A library and an app's web build get
// neither.
export function compilesAsApp(target) {
    return state.config.target?.runtimeEnv === 'app' && runtimeEnvsOf(target.platform).includes('app');
}

// What an app's own code compiles with: CROSSBIND_APP, and on iOS its debug information, from which the archive's dSYM
// gives App Store Connect its files and lines; Android's NDK keeps that by default.
export const appCompileOptions = (target) => (compilesAsApp(target) ? ['-DCROSSBIND_APP', ...(target.platform === 'ios' ? ['-g'] : [])] : []);

export function appApiHeader() {
    const header = `${resolveAppHostRoot()}/cpp/include/crossbind/app.h`;
    if (!fs.existsSync(header)) {
        throw new Error('crossbind: this @crossbind/core-app-host has no <crossbind/app.h>; update it to the version of crossbind.');
    }
    return header;
}

// The app host can lie outside the docker mount, so the header is copied into the build tree first; returns the
// include dir.
export function stageAppApiInclude(dir) {
    fs.mkdirSync(`${dir}/include/crossbind`, { recursive: true });
    fs.copyFileSync(appApiHeader(), `${dir}/include/crossbind/app.h`);
    return `${dir}/include`;
}
