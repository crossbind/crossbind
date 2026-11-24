import fs from 'node:fs';
import { spawn } from 'node:child_process';
import state from '../state/index.js';
import buildDependencies from '../actions/buildDependencies.js';
import { getFilteredBuildTargets } from '../actions/target.js';
import { appLayout, appOutputName, appTargetParams, buildProjectApp, publishApp } from '../actions/buildApp.js';
import { buildApk } from '../actions/androidGradle.js';
import openOnDevice from '../actions/androidDevice.js';
import openInSimulator, { buildForSimulator } from '../actions/iosSimulator.js';
import openOnIosDevice, {
    buildForIosDevice, connectedIosDevice, iosDevServer, iosDeviceAppEnv,
} from '../actions/iosDevice.js';
import { isAppSource } from '../utils/appSources.js';

// How long the app that runs gets to end before a new host opens.
const STOP_TIMEOUT_MS = 5000;
const NATIVE_KINDS = ['header', 'source', 'rust'];

// During development an app opens on the dev server. Its host is built for this machine first, an iOS app's for the
// Simulator or the iPhone or iPad CROSSBIND_APP_DEVICE names, or an Android app's for the attached device, and built and
// reopened whenever the native code or the native imports of the page change; the page itself reloads as the dev server
// reloads any page. Closing the window, or the app on the Simulator or device, ends the session. The dev server gives
// invalidate() to drop the modules it transformed, end(status) to close itself, and error(message) to report.
export default function appDevSession({ invalidate, end, error }, kindOf) {
    let iosDevice = null;
    let address = null;
    let devParams = null;
    let target = null;
    let appEnv = null;
    let app = null;
    let closeApp = null;
    let mobileApp = null;
    let building = Promise.resolve(false);
    const isMobile = () => ['ios', 'android'].includes(target.platform);

    async function build() {
        await buildDependencies({ targetParams: { ...devParams, buildType: [target.buildType] } });
        const changed = await buildProjectApp(target);
        if (!isMobile() || (!changed && mobileApp)) return changed;
        // A mobile app links in Xcode or packages in Gradle, as a desktop host links in its build: before the app that
        // runs gives way. Its project holds no page, which the dev server serves.
        const project = publishApp(target, { to: `${state.config.paths.build}/${appOutputName(target)}.debug` });
        if (target.platform === 'android') mobileApp = buildApk(project);
        else mobileApp = iosDevice ? buildForIosDevice(project, iosDevice) : buildForSimulator(project, 'Debug');
        return true;
    }

    function open() {
        if (!isMobile()) {
            const executable = `${state.config.paths.build}/${target.appName}/${appLayout(target).executable}`;
            return spawn(executable, [], { stdio: 'inherit', env: { ...process.env, ...appEnv } });
        }
        // The terminal's input stays the dev server's: simctl, devicectl and adb would forward it to the device.
        const options = { env: appEnv, stdio: ['ignore', 'inherit', 'inherit'] };
        let opened;
        if (target.platform === 'android') opened = openOnDevice(mobileApp, options);
        else opened = iosDevice ? openOnIosDevice(mobileApp, { ...options, device: iosDevice }) : openInSimulator(mobileApp, { ...options, show: true });
        closeApp = opened.close;
        return opened.child;
    }

    function launch() {
        const child = open();
        app = child;
        child.once('error', (failure) => {
            error(`crossbind: the app did not start: ${failure.message}`);
            if (app === child) end(1);
        });
        child.once('exit', (code) => {
            if (app === child) end(code ?? 1);
        });
    }

    // Resolves once the app that runs has ended: a new one that met it would hand its launch over to it, as an app that
    // app.singleInstance keeps to one instance does, and leave.
    function stop() {
        const running = app;
        app = null;
        closeApp?.();
        closeApp = null;
        if (!running || running.exitCode !== null || running.signalCode !== null) return Promise.resolve();
        const ended = new Promise((resolve) => running.once('exit', resolve));
        // An app on an iPhone or iPad ends by its devicectl's signal, which closing it sent already.
        if (!running.killed) running.kill();
        // A host SIGTERM cannot end, as one stopped in a debugger, does not hold the session up.
        const killer = setTimeout(() => running.kill('SIGKILL'), STOP_TIMEOUT_MS);
        return ended.finally(() => clearTimeout(killer));
    }

    // One build at a time, so an edit during a build waits for it. The window keeps running until a new host is ready,
    // and a build that changed nothing leaves it alone, unless no app runs because the last one failed to open.
    // Resolves to whether the app opened anew.
    function refresh({ always = false } = {}) {
        // The app opens anew within the same turn as its build, so a second edit meanwhile opens no second app.
        const next = building.catch(() => {}).then(async () => {
            const changed = await build();
            if (!changed && !always && app) return false;
            // A new host may bind other names, so its page transforms the header modules again.
            invalidate();
            await stop();
            launch();
            return true;
        });
        building = next;
        return next;
    }

    return Object.freeze({
        // An iPhone or iPad reaches the dev server at this Mac's address on its cable or network, which alone the server
        // listens on, unless the dev server's own host option names an address or every one.
        host(requested) {
            if (process.env.CROSSBIND_APP_PLATFORM !== 'ios' || !process.env.CROSSBIND_APP_DEVICE) return undefined;
            iosDevice = connectedIosDevice(process.env.CROSSBIND_APP_DEVICE);
            const devServer = iosDevServer(iosDevice, requested);
            address = devServer.address;
            return devServer.host;
        },
        // This machine, the Simulator or the iPhone or iPad named, or the Android device attached now. iOS and Android
        // keep targets without a runtime environment for React Native, which the filter leaves out.
        begin() {
            devParams = appTargetParams({ dev: true });
            [target] = getFilteredBuildTargets(devParams, { buildType: 'debug', runtimeEnv: 'app' });
        },
        // An iPhone or iPad opens its own localhost, which its debug host relays to the dev server at this Mac's address.
        open({ port, base }) {
            appEnv = iosDevice ? iosDeviceAppEnv(address, port, base) : { CROSSBIND_APP_URL: `http://localhost:${port}${base}` };
            return refresh({ always: true });
        },
        // Null when the edit is none of the app's; else whether the app opened anew, and whether the edit was native code.
        async changed(file) {
            const { build: buildDir, cache, project } = state.config.paths;
            if (file.startsWith(buildDir) || file.startsWith(cache)) return null;
            const native = NATIVE_KINDS.includes(kindOf(file));
            if (!native && !isAppSource(project, file)) return null;
            try {
                // An app opened anew loads its page anew.
                if (await refresh()) return { reopened: true, native };
            } catch (failure) {
                error(failure.message);
            }
            return { reopened: false, native };
        },
        async glue() {
            await building;
            return fs.readFileSync(`${state.config.paths.build}/${target.appJsName}`, { encoding: 'utf8' });
        },
        stop,
    });
}
