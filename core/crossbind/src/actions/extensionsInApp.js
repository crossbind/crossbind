import extensionApi from './extensionApi.js';
import state from '../state/index.js';
import {
    appExtensionsOf, ownExtensions, withFromApp, withRoles, withoutNamed,
} from '../utils/appExtensions.js';
import resolveAppHostRoot from '../utils/resolveAppHost.js';

// The platforms as an extension's api names them.
const API_PLATFORMS = { darwin: 'macos', win32: 'windows' };

// The extensions an app of this platform has: crossbind's own but those app.without leaves out, then those
// crossbind.config.js lists, each with the roles it holds, which a listed one's replaces takes from the host's, and the
// options it takes from the app's config, where it does.
export default function extensionsInApp(platform, warn) {
    const own = ownExtensions(resolveAppHostRoot());
    const { app, extensions = [] } = state.config;
    const held = withRoles(appExtensionsOf(withoutNamed(own, app)), appExtensionsOf(extensions), warn, appExtensionsOf(own));
    return withFromApp(held, (name) => extensionApi(name, { platform: API_PLATFORMS[platform] ?? platform, isGuided: false }));
}
