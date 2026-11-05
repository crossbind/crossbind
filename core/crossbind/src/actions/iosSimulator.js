import { spawn, spawnSync } from 'node:child_process';
import { EXEC_MAX_BUFFER } from './run.js';
import state from '../state/index.js';
import logger from '../utils/logger.js';

let hasToldNoWindow = false;

function tool(program, args) {
    const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER });
    if (result.status !== 0) {
        throw new Error(`crossbind: ${program} ${args.join(' ')} failed: ${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || result.error?.message}`);
    }
    return result.stdout;
}

// Newer iOS first: 27.0 before 18.5.
function byNewerIos(a, b) {
    const index = a.version.findIndex((part, i) => part !== b.version[i]);
    return index === -1 ? 0 : (b.version[index] ?? 0) - a.version[index];
}

// The Simulator an app opens in: one already booted, or else an iPhone of the newest iOS, booted for it.
function simulator() {
    const { devices } = JSON.parse(tool('xcrun', ['simctl', 'list', 'devices', 'available', '--json']));
    const all = Object.entries(devices)
        .filter(([runtime]) => runtime.includes('.SimRuntime.iOS-'))
        .flatMap(([runtime, list]) => list.map((device) => ({ ...device, version: runtime.split('.SimRuntime.iOS-')[1].split('-').map(Number) })));
    const booted = all.find((device) => device.state === 'Booted');
    if (booted) return booted.udid;
    const [newest] = all.filter((device) => device.name.startsWith('iPhone')).sort(byNewerIos);
    if (!newest) throw new Error('crossbind: no iPhone Simulator is installed. Add the iOS platform in Xcode, under Settings > Components.');
    tool('xcrun', ['simctl', 'boot', newest.udid]);
    tool('xcrun', ['simctl', 'bootstatus', newest.udid, '-b']);
    return newest.udid;
}

// Builds an iOS app's Xcode project for the Simulator, and returns the app.
export function buildForSimulator(project, configuration = 'Release') {
    const { name } = state.config.general;
    const products = `${state.config.paths.build}/xcode`;
    tool('xcodebuild', ['-project', `${project}/${name}.xcodeproj`, '-configuration', configuration, '-sdk', 'iphonesimulator',
        `SYMROOT=${products}`, '-quiet', 'build']);
    return `${products}/${configuration}-iphonesimulator/${name}.app`;
}

// Opens a Simulator build of an iOS app, with `env` in its environment, in the Simulator of the device returned. The
// process returned carries the app's output and ends with the app; close() ends the app.
export default function openInSimulator(app, { env = {}, show = false, stdio = 'pipe' } = {}) {
    const device = simulator();
    // Simulator.app only shows the device, which runs the app without it as well.
    if (show && spawnSync('open', ['-b', 'com.apple.iphonesimulator']).status !== 0 && !hasToldNoWindow) {
        hasToldNoWindow = true;
        logger.info('crossbind: Simulator.app is not installed, so the Simulator shows no window; the app runs in it all the same.');
    }
    tool('xcrun', ['simctl', 'install', device, app]);
    const bundleId = tool('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', `${app}/Info.plist`]).trim();
    const childEnv = { ...process.env };
    Object.entries(env).forEach(([key, value]) => {
        childEnv[`SIMCTL_CHILD_${key}`] = value;
    });
    const child = spawn('xcrun', ['simctl', 'launch', '--console-pty', '--terminate-running-process', device, bundleId], { env: childEnv, stdio });
    return { child, device, close: () => spawnSync('xcrun', ['simctl', 'terminate', device, bundleId]) };
}
