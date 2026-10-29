import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { EXEC_MAX_BUFFER } from './run.js';
import { appTeam } from './buildApp.js';
import { xcodebuild, xcodeTeams } from './appStoreConnect.js';
import state from '../state/index.js';
import { appId } from '../utils/appOptions.js';

// How much of what devicectl says as it launches the app is read for a failure; the app's own output follows it.
const SAID_LIMIT = 64 * 1024;
const LAUNCHED = /Launched application with/;
// Addresses of this Mac that no device reaches.
const LOOPBACK = ['localhost', '127.0.0.1', '::1'];
// Vite's --host for every address of this Mac.
const EVERY_ADDRESS = [true, '0.0.0.0', '::'];

const developerModeFix = (name) => `Developer Mode is off on ${name}: turn it on in Settings › Privacy & Security › Developer Mode, which restarts ${name}, and run again.`;

// What a failed install or launch on the device means, in devicectl's words, and what the developer does about it.
const FIXES = [
    { pattern: /device was still locked|device is currently locked/i, fix: ({ name }) => `unlock ${name}, and run again.` },
    { pattern: /developer mode is not enabled/i, fix: ({ name }) => developerModeFix(name) },
    {
        pattern: /0xe8008012|provisioning profile cannot be installed on this device/i,
        fix: ({ name }) => `the app's profile leaves ${name} out, which Xcode registers with the team as it builds for it: run again, and if it stays out, run the app on ${name} from Xcode once.`,
    },
    {
        pattern: /not been explicitly trusted by the user/i,
        fix: ({ name }) => `${name} does not trust the app's developer yet, as with a free team's first app: on ${name}, open Settings › General › VPN & Device Management, trust the Apple Development entry, and run again.`,
    },
];

function tool(program, args, options = {}) {
    const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER, ...options });
    if (result.status !== 0) {
        throw new Error(`crossbind: ${program} ${args.join(' ')} failed: ${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || result.error?.message}`);
    }
    return result.stdout;
}

// devicectl's output, or its failure with what it said and, where known, what to do on `device`.
function devicectl(args, device = null) {
    const result = spawnSync('xcrun', ['devicectl', ...args], { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER });
    if (result.status === 0) return result.stdout;
    const said = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || result.error?.message;
    const fix = device && FIXES.find(({ pattern }) => pattern.test(said));
    throw new Error([`crossbind: devicectl ${args.join(' ')} failed: ${said}`, ...(fix ? [`crossbind: ${fix.fix(device)}`] : [])].join('\n'));
}

// The iPhones and iPads this Mac reaches, on a cable or over the network; devicectl lists the Simulators too.
function physicalDevices() {
    return JSON.parse(devicectl(['list', 'devices', '--json-output', '-'])).result.devices
        .filter(({ hardwareProperties: hardware, connectionProperties: connection }) => hardware?.reality === 'physical'
            && hardware.platform === 'iOS' && connection?.transportType)
        .map(({ deviceProperties: properties, hardwareProperties: hardware, connectionProperties: connection }) => ({
            name: properties?.name ?? hardware.udid,
            udid: hardware.udid,
            isWired: connection.transportType === 'wired',
            isPaired: connection.pairingState === 'paired',
            developerMode: properties?.developerModeStatus,
        }));
}

// iOS names a device with ’, as Ada’s iPhone, where a terminal types '.
const plainName = (name) => name.replaceAll('’', "'");

function pick(devices, choice) {
    const found = choice ? devices.filter(({ name, udid }) => plainName(name) === plainName(choice) || udid === choice) : devices;
    if (found.length === 1) return found[0];
    if (found.length > 1) {
        const names = found.map(({ name }) => name);
        // A name two devices share names neither; a UDID is one device's.
        const example = new Set(names).size === names.length ? `"${found.at(-1).name}"` : found.at(-1).udid;
        throw new Error(`crossbind: ${found.length} iPhones and iPads are connected (${names.join(', ')}): name one, as --device ${example}.`);
    }
    throw new Error(choice
        ? `crossbind: no iPhone or iPad named ${choice} is connected; connected: ${devices.map(({ name }) => name).join(', ') || 'none'}.`
        : 'crossbind: no iPhone or iPad is connected. Connect one with a cable, unlock it, and tap Trust on it if it asks.');
}

// The iPhone or iPad an app runs on in development: the one `choice` names, by its name or UDID, else the only one
// connected. It gets paired with this Mac, which the phone's Trust allows, and runs development apps once its Developer
// Mode is on.
export function connectedIosDevice(choice) {
    let device = pick(physicalDevices(), choice);
    if (!device.isPaired) {
        console.log(`crossbind: tap Trust on ${device.name}, then enter its passcode, to pair it with this Mac.`);
        devicectl(['manage', 'pair', '--device', device.udid], device);
        device = pick(physicalDevices(), device.udid);
    }
    // A device just paired may not say yet; its install then names the fix, if it needs one.
    if (device.developerMode === 'disabled') throw new Error(`crossbind: ${developerModeFix(device.name)}`);
    return { name: device.name, udid: device.udid, isWired: device.isWired };
}

// What `crossbind app dev --device` hands Vite as CROSSBIND_APP_DEVICE: the device it names, else the UDID of the only
// one connected.
export function iosDeviceOption(choice, platform) {
    if (platform !== 'ios') {
        throw new Error('crossbind: --device opens an iOS app on an iPhone or iPad: add -p ios. An Android app opens on the attached device already, which ANDROID_SERIAL picks among several.');
    }
    return choice === true || choice === '' ? connectedIosDevice().udid : choice;
}

// The network interfaces the device's USB connection makes on this Mac, which ioreg holds under the USB device whose
// serial number is the device's UDID without its dash. plutil turns no binary, date or non-finite value into JSON,
// which ioreg's tree holds and the lookup needs none of.
function cableInterfaces({ name, udid }) {
    const tree = spawnSync('ioreg', ['-a', '-r', '-c', 'IOUSBHostDevice', '-l'], { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER }).stdout;
    if (!tree) return [];
    const input = tree.replace(/<(data|date|real)>[^<]*<\/\1>/g, '<string></string>');
    const json = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input, encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER });
    if (json.status !== 0) {
        throw new Error(`crossbind: cannot read the USB devices ioreg lists, among them the cable to ${name}: ${(json.stderr ?? '').trim() || json.error?.message}`);
    }
    const serial = udid.replaceAll('-', '');
    const nodes = (node) => [node, ...(node.IORegistryEntryChildren ?? []).flatMap(nodes)];
    const usb = [JSON.parse(json.stdout)].flat().flatMap(nodes).find((node) => node['USB Serial Number'] === serial);
    return usb ? nodes(usb).map((node) => node['BSD Name']).filter(Boolean) : [];
}

function defaultRouteInterface() {
    return spawnSync('route', ['-n', 'get', 'default'], { encoding: 'utf8' }).stdout?.match(/interface:\s*(\S+)/)?.[1];
}

// The address of this Mac that the device reaches the dev server at: on the device's own cable, which needs no network,
// else on the default route's network, which the device must share. A .local name or the CoreDevice tunnel reaches
// nothing from the app.
export function iosDeviceAddress(device) {
    const route = device.isWired ? null : defaultRouteInterface();
    if (/^(utun|ipsec|ppp)/.test(route ?? '')) {
        throw new Error(`crossbind: this Mac's default route goes through ${route}, a VPN, which ${device.name} cannot reach: give this Mac's address on the phone's network with --host <address>, or connect the phone with a cable.`);
    }
    const interfaces = device.isWired ? cableInterfaces(device) : [route].filter(Boolean);
    const address = interfaces.map((name) => os.networkInterfaces()[name]?.find(({ family }) => family === 'IPv4')?.address).find(Boolean);
    if (address) return address;
    throw new Error(device.isWired
        ? `crossbind: this Mac has no address on the cable to ${device.name} yet: plug it in again, or give the address the phone reaches this Mac at with --host <address>.`
        : `crossbind: this Mac has no network address ${device.name} could reach it at: join the network the phone is on, or give an address with --host <address>.`);
}

// Where the dev server is for the device: the address Vite's own --host names, else the one this Mac has for the
// device, and the host Vite listens on, that one address unless --host asks for every one.
export function iosDevServer(device, requested) {
    if (LOOPBACK.includes(requested)) {
        throw new Error(`crossbind: ${device.name} cannot reach this Mac at ${requested}: give --host an address the phone reaches, or leave --host out.`);
    }
    if (EVERY_ADDRESS.includes(requested)) return { address: iosDeviceAddress(device), host: requested };
    const address = typeof requested === 'string' ? requested : iosDeviceAddress(device);
    return { address, host: address };
}

function noTeam() {
    const teams = xcodeTeams({ withPersonal: true }).map(({ id, name }) => `${id} (${name})`);
    const which = teams.length > 0
        ? `one of the teams Xcode is signed in to: ${teams.join(', ')}`
        : 'the team of an account you sign in to in Xcode, under Settings › Accounts; a free Apple Account has a Personal Team';
    return `crossbind: an app on an iPhone or iPad is signed for an Apple team: set app.team in crossbind.config.js, or XCODE_DEVELOPMENT_TEAM in ~/.crossbind.json, to ${which}.`;
}

// Builds an iOS app's Xcode project for the device, signed for the app's team by Xcode, which registers the device and
// the bundle id with the team and makes the profile as it needs, and returns the app. xcodebuild takes a destination
// only with a scheme, which Xcode makes of the project's target.
export function buildForIosDevice(project, device) {
    const { name } = state.config.general;
    const team = appTeam();
    if (!team) throw new Error(noTeam());
    const products = `${state.config.paths.build}/xcode`;
    fs.mkdirSync(products, { recursive: true });
    xcodebuild(`the build for ${device.name}`, [
        '-project', `${project}/${name}.xcodeproj`, '-scheme', name, '-configuration', 'Debug', '-sdk', 'iphoneos', '-destination', `id=${device.udid}`,
        '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', `SYMROOT=${products}`, 'build',
    ], `${products}/device.log`, { team, id: appId(state.config) });
    return `${products}/Debug-iphoneos/${name}.app`;
}

// Installs an iOS app on the device and opens it with `env` in its environment. The process returned is devicectl,
// which xcrun runs in its own place: it carries the app's output and ends with the app, and a signal to it ends the app
// too. A launch the phone refuses, as one that waits for the developer's trust, names its fix.
export default function openOnIosDevice(app, { env = {}, stdio = 'pipe', device } = {}) {
    devicectl(['device', 'install', 'app', '--device', device.udid, app], device);
    const bundleId = tool('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', `${app}/Info.plist`]).trim();
    const [input, output, errors] = typeof stdio === 'string' ? [stdio, stdio, stdio] : stdio;
    const child = spawn('xcrun', [
        'devicectl', 'device', 'process', 'launch', '--device', device.udid, '--console', '--terminate-existing',
        '--environment-variables', JSON.stringify(env), bundleId,
    ], { stdio: [input, output, 'pipe'] });
    child.stderr.setEncoding('utf8');
    let said = '';
    child.stderr.on('data', (text) => {
        if (errors === 'inherit') process.stderr.write(text);
        if (said === null) return;
        said += text;
        const fix = FIXES.find(({ pattern }) => pattern.test(said));
        if (fix) process.stderr.write(`crossbind: ${fix.fix(device)}\n`);
        if (fix || LAUNCHED.test(said) || said.length > SAID_LIMIT) said = null;
    });
    return { child, close: () => child.kill() };
}
