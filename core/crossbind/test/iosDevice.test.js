import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: { general: { name: 'demo' }, paths: {}, app: { id: 'com.example.demo' }, system: {} } };
vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/actions/run.js', () => ({ EXEC_MAX_BUFFER: 1024 * 1024 }));
const team = { id: 'ABCDE12345' };
vi.mock('../src/actions/buildApp.js', () => ({ appTeam: () => team.id }));

// devicectl lists `apple.devices`, pairs them all and installs as `apple.install` says; ioreg holds the USB devices of
// `apple.usb`, route the default route's interface and networkInterfaces this Mac's addresses; xcodebuild writes
// `apple.build` where its stdio points, and Xcode's settings hold `apple.teams`.
const apple = {};
// ioreg's tree holds binary, date and non-finite values, which plutil turns into no JSON.
const IOREG_XML = '<plist version="1.0"><array><dict><key>IOCFPlugInTypes</key><data>\n\tAAEC\n\tAwQF\n\t</data><key>Since</key>'
    + '<date>2026-10-29T18:15:00Z</date><key>Ratio</key><real>nan</real></dict></array></plist>';
const PHONE = { name: "Ada's iPhone", udid: '00008140-000A1B2C3D4E5F60', transport: 'wired', pairing: 'paired', developerMode: 'enabled' };
const asListed = (device) => ({
    deviceProperties: { name: device.name, developerModeStatus: device.developerMode },
    hardwareProperties: { udid: device.udid, reality: device.reality ?? 'physical', platform: 'iOS' },
    connectionProperties: { pairingState: device.pairing, transportType: device.transport },
});
const spawnSync = vi.fn((program, args, options) => {
    apple.calls.push([program, ...args]);
    if (program === 'xcrun' && args[1] === 'list') return { status: 0, stdout: JSON.stringify({ result: { devices: apple.devices.map(asListed) } }), stderr: '' };
    if (program === 'xcrun' && args[1] === 'manage') {
        apple.devices = apple.devices.map((device) => ({ ...device, pairing: 'paired', developerMode: 'enabled' }));
        return { status: 0, stdout: 'Paired with device\n', stderr: '' };
    }
    if (program === 'xcrun' && args[2] === 'install') return apple.install ?? { status: 0, stdout: 'App installed\n', stderr: '' };
    if (program === 'ioreg') return { status: 0, stdout: apple.usb ? IOREG_XML : '', stderr: '' };
    if (program === 'plutil' && args[0] === '-convert') {
        if (apple.plutilError || /<data>|<date>|<real>/.test(options.input)) return { status: 1, stdout: '', stderr: apple.plutilError ?? '<stdin>: Invalid object in plist for JSON format\n' };
        return { status: 0, stdout: JSON.stringify(apple.usb), stderr: '' };
    }
    if (program === 'plutil' && args[1] === 'CFBundleIdentifier') return { status: 0, stdout: 'com.example.demo\n', stderr: '' };
    if (program === 'route') return { status: 0, stdout: `   route to: default\ndestination: default\n  interface: ${apple.route}\n`, stderr: '' };
    if (program === 'xcodebuild') {
        apple.builds.push(args);
        fs.writeSync(options.stdio[1], apple.build?.output ?? '** BUILD SUCCEEDED **\n');
        return { status: apple.build?.status ?? 0, signal: null };
    }
    if (program === 'defaults') return { status: apple.teams ? 0 : 1, stdout: Buffer.from('<plist/>') };
    if (program === 'plutil' && args[0] === '-extract') return { status: 0, stdout: JSON.stringify(apple.teams) };
    return { status: 1, stdout: '', stderr: `no ${program} in this test` };
});
const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }), kill: vi.fn() });
    apple.launched = child;
    return child;
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync, spawn }));
// This file imports node:os itself, which loads the mock before the module's own variables exist.
const { networkInterfaces } = vi.hoisted(() => ({ networkInterfaces: vi.fn() }));
networkInterfaces.mockImplementation(() => apple.interfaces);
vi.mock('node:os', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, networkInterfaces, default: { ...real.default, networkInterfaces } };
});

const {
    buildForIosDevice, connectedIosDevice, iosDeviceAddress, iosDeviceOption, iosDevServer, default: openOnIosDevice,
} = await import('../src/actions/iosDevice.js');

const DEVICE = { name: "Ada's iPhone", udid: PHONE.udid, isWired: true };
const IPHONE_USB = {
    'USB Product Name': 'iPhone',
    'USB Serial Number': '00008140000A1B2C3D4E5F60',
    IORegistryEntryChildren: [{ IORegistryEntryChildren: [{ 'BSD Name': 'en9' }] }],
};
let build;

beforeEach(() => {
    build = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-ios-device-'));
    state.config.paths.build = build;
    Object.assign(apple, {
        calls: [], builds: [], devices: [{ ...PHONE }], usb: null, route: 'en0', interfaces: {}, install: null, build: null, teams: null, launched: null,
        plutilError: null,
    });
    team.id = 'ABCDE12345';
});

afterEach(() => {
    fs.rmSync(build, { recursive: true, force: true });
});

describe('the iPhone or iPad an app opens on during development', () => {
    test('is the one connected, the Simulators left out, on its cable or on the network', () => {
        apple.devices = [{ ...PHONE }, { ...PHONE, name: 'iPhone 18 Pro', udid: '697545F6-223E-4569-AEED-C75ADD6AB3E5', reality: 'virtual', transport: 'sameMachine' }];
        expect(connectedIosDevice()).toEqual(DEVICE);

        apple.devices = [{ ...PHONE, transport: 'localNetwork' }];
        expect(connectedIosDevice().isWired).toBe(false);
    });

    test('is the one named, by its name or its UDID, among several', () => {
        apple.devices = [{ ...PHONE }, { ...PHONE, name: "Ada's iPad", udid: '00008112-0001020304050607' }];

        expect(() => connectedIosDevice()).toThrow(`2 iPhones and iPads are connected (Ada's iPhone, Ada's iPad): name one, as --device "Ada's iPad"`);
        expect(connectedIosDevice("Ada's iPad").udid).toBe('00008112-0001020304050607');
        expect(connectedIosDevice(PHONE.udid).name).toBe("Ada's iPhone");
    });

    test('is named by its UDID where two share a name', () => {
        apple.devices = [{ ...PHONE, name: 'iPhone' }, { ...PHONE, name: 'iPhone', udid: '00008112-0001020304050607' }];

        expect(() => connectedIosDevice()).toThrow('2 iPhones and iPads are connected (iPhone, iPhone): name one, as --device 00008112-0001020304050607.');
    });

    test("is named with the ' a terminal types for the ’ iOS names a device with", () => {
        apple.devices = [{ ...PHONE, name: 'Ada’s iPhone' }];

        expect(connectedIosDevice("Ada's iPhone").name).toBe('Ada’s iPhone');
    });

    test('is none, with how to connect one', () => {
        apple.devices = [];
        expect(() => connectedIosDevice()).toThrow('no iPhone or iPad is connected. Connect one with a cable');

        apple.devices = [{ ...PHONE }];
        expect(() => connectedIosDevice('Grace')).toThrow("no iPhone or iPad named Grace is connected; connected: Ada's iPhone.");
    });

    test('pairs with this Mac first, once the phone trusts it', () => {
        apple.devices = [{ ...PHONE, pairing: 'unpaired', developerMode: undefined }];
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        expect(connectedIosDevice()).toEqual(DEVICE);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("tap Trust on Ada's iPhone"));
        expect(apple.calls).toContainEqual(['xcrun', 'devicectl', 'manage', 'pair', '--device', PHONE.udid]);
        log.mockRestore();
    });

    test('runs development apps once Developer Mode is on, and names where it is', () => {
        apple.devices = [{ ...PHONE, developerMode: 'disabled' }];

        expect(() => connectedIosDevice()).toThrow("Developer Mode is off on Ada's iPhone: turn it on in Settings › Privacy & Security › Developer Mode");
    });

    test('takes a device that does not say yet whether Developer Mode is on, which its install tells', () => {
        apple.devices = [{ ...PHONE, developerMode: undefined }];

        expect(connectedIosDevice()).toEqual(DEVICE);
    });

    test('is the one --device names, or the only one connected, for an iOS app alone', () => {
        expect(iosDeviceOption(true, 'ios')).toBe(PHONE.udid);
        expect(iosDeviceOption('', 'ios')).toBe(PHONE.udid);
        expect(iosDeviceOption("Ada's iPhone", 'ios')).toBe("Ada's iPhone");
        expect(() => iosDeviceOption(true, 'android')).toThrow('--device opens an iOS app on an iPhone or iPad: add -p ios');
    });
});

describe('the address an iPhone reaches the dev server at', () => {
    test("is this Mac's on the phone's own cable, the interface ioreg finds under the phone's serial", () => {
        apple.usb = [{ 'USB Product Name': 'Keyboard', 'USB Serial Number': 'K1' }, IPHONE_USB];
        apple.interfaces = {
            en0: [{ family: 'IPv4', address: '192.168.1.6' }],
            en9: [{ family: 'IPv6', address: 'fe80::180c:35b9:ab9:cc50' }, { family: 'IPv4', address: '169.254.115.27' }],
        };

        expect(iosDeviceAddress(DEVICE)).toBe('169.254.115.27');
    });

    test("is this Mac's on its default route for a phone on the network", () => {
        apple.interfaces = { en0: [{ family: 'IPv4', address: '192.168.1.6' }] };

        expect(iosDeviceAddress({ ...DEVICE, isWired: false })).toBe('192.168.1.6');
    });

    test('is none while the cable has no address yet, which --host can give instead', () => {
        apple.usb = [IPHONE_USB];

        expect(() => iosDeviceAddress(DEVICE)).toThrow("this Mac has no address on the cable to Ada's iPhone yet");
        expect(() => iosDeviceAddress(DEVICE)).toThrow('--host');
    });

    test('says why where plutil cannot read the USB devices ioreg lists', () => {
        apple.usb = [IPHONE_USB];
        apple.plutilError = '<stdin>: Unexpected character at line 1\n';

        expect(() => iosDeviceAddress(DEVICE)).toThrow("cannot read the USB devices ioreg lists, among them the cable to Ada's iPhone: <stdin>: Unexpected character at line 1");
    });

    test('is none through a VPN, which a phone on the network cannot reach, where the cable or --host can do', () => {
        apple.route = 'utun4';
        apple.interfaces = { utun4: [{ family: 'IPv4', address: '10.8.0.2' }] };

        expect(() => iosDeviceAddress({ ...DEVICE, isWired: false })).toThrow("this Mac's default route goes through utun4, a VPN, which Ada's iPhone cannot reach");
    });
});

describe('the dev server an iPhone opens', () => {
    beforeEach(() => {
        apple.usb = [IPHONE_USB];
        apple.interfaces = { en9: [{ family: 'IPv4', address: '169.254.115.27' }] };
    });

    test("listens on this Mac's address for the device alone, where Vite's --host names none", () => {
        expect(iosDevServer(DEVICE, undefined)).toEqual({ address: '169.254.115.27', host: '169.254.115.27' });
        expect(iosDevServer(DEVICE, false)).toEqual({ address: '169.254.115.27', host: '169.254.115.27' });
    });

    test('is at the address --host names, which no lookup second-guesses', () => {
        expect(iosDevServer(DEVICE, '192.168.1.20')).toEqual({ address: '192.168.1.20', host: '192.168.1.20' });
        expect(apple.calls.some(([program]) => program === 'ioreg')).toBe(false);
    });

    test("listens on every address where --host asks for them, and the app opens this Mac's for the device", () => {
        for (const every of [true, '0.0.0.0', '::']) {
            expect(iosDevServer(DEVICE, every)).toEqual({ address: '169.254.115.27', host: every });
        }
    });

    test('is never on this Mac alone, which the phone cannot reach', () => {
        expect(() => iosDevServer(DEVICE, 'localhost')).toThrow("Ada's iPhone cannot reach this Mac at localhost: give --host an address the phone reaches");
        expect(() => iosDevServer(DEVICE, '127.0.0.1')).toThrow('cannot reach this Mac at 127.0.0.1');
    });
});

describe("an iOS app's build for the device", () => {
    test('has Xcode sign it for the team, registering the device and making its profile', () => {
        const app = buildForIosDevice('/p/demo-ios.debug', DEVICE);

        expect(apple.builds.at(-1)).toEqual([
            '-project', '/p/demo-ios.debug/demo.xcodeproj', '-scheme', 'demo', '-configuration', 'Debug', '-sdk', 'iphoneos',
            '-destination', `id=${PHONE.udid}`, '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', `SYMROOT=${build}/xcode`, 'build',
        ]);
        expect(app).toBe(`${build}/xcode/Debug-iphoneos/demo.app`);
    });

    test('needs a team, and names those Xcode is signed in to, free ones among them', () => {
        team.id = '';
        apple.teams = {
            ada: [{ teamID: 'ABCDE12345', teamName: 'Ada Ltd', isFreeProvisioningTeam: false }],
            free: [{ teamID: 'FREE123456', teamName: 'Ada Lovelace (Personal Team)', isFreeProvisioningTeam: true }],
        };

        expect(() => buildForIosDevice('/p/demo-ios.debug', DEVICE)).toThrow('ABCDE12345 (Ada Ltd), FREE123456 (Ada Lovelace (Personal Team))');
        expect(apple.builds).toEqual([]);
    });

    test('asks for an id of its own where another team holds the one it has', () => {
        apple.build = {
            status: 65,
            output: 'error: Failed Registering Bundle Identifier: The app identifier "com.example.demo" cannot be registered to your development team because it is not available. Change your bundle identifier to a unique string to try again.\n',
        };

        expect(() => buildForIosDevice('/p/demo-ios.debug', DEVICE)).toThrow('set app.id in crossbind.config.js to an id of your own');
    });
});

describe('an iOS app opened on the iPhone', () => {
    test('installs, then launches with its console and its environment, as the app its Info.plist names', () => {
        const { child } = openOnIosDevice('/x/demo.app', { env: { CROSSBIND_APP_URL: 'http://169.254.115.27:5173/' }, device: DEVICE });

        expect(apple.calls).toContainEqual(['xcrun', 'devicectl', 'device', 'install', 'app', '--device', PHONE.udid, '/x/demo.app']);
        expect(spawn).toHaveBeenLastCalledWith('xcrun', [
            'devicectl', 'device', 'process', 'launch', '--device', PHONE.udid, '--console', '--terminate-existing',
            '--environment-variables', '{"CROSSBIND_APP_URL":"http://169.254.115.27:5173/"}', 'com.example.demo',
        ], expect.anything());
        expect(child).toBe(apple.launched);
    });

    test('names the fix where the install fails on a locked phone, or with a profile that leaves it out', () => {
        apple.install = { status: 1, stdout: '', stderr: 'ERROR: The developer disk image could not be mounted on this device.\n  The operation failed because the device was still locked.\n' };
        expect(() => openOnIosDevice('/x/demo.app', { device: DEVICE })).toThrow("unlock Ada's iPhone");

        apple.install = { status: 1, stdout: '', stderr: 'Failed to install embedded profile for com.example.demo : 0xe8008012 (This provisioning profile cannot be installed on this device.)\n' };
        expect(() => openOnIosDevice('/x/demo.app', { device: DEVICE })).toThrow("the app's profile leaves Ada's iPhone out");
    });

    test("names the trust a free team's app waits for, where the phone refuses to launch it", () => {
        const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        openOnIosDevice('/x/demo.app', { stdio: ['ignore', 'inherit', 'inherit'], device: DEVICE });

        apple.launched.stderr.emit('data', 'ERROR: The application failed to launch.\n  Unable to launch com.example.demo because it has an invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user.\n');

        expect(apple.launched.stderr.setEncoding).toHaveBeenCalledWith('utf8');
        expect(write).toHaveBeenCalledWith(expect.stringContaining('Unable to launch com.example.demo'));
        expect(write).toHaveBeenCalledWith(expect.stringContaining('Settings › General › VPN & Device Management'));
        write.mockRestore();
    });

    test("finds devicectl's words across the pieces they come in, and leaves a piped output to its reader", () => {
        const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        openOnIosDevice('/x/demo.app', { device: DEVICE });

        apple.launched.stderr.emit('data', 'Unable to launch com.example.demo because its profile has not been expl');
        apple.launched.stderr.emit('data', 'icitly trusted by the user.\n');

        expect(write.mock.calls.map(([text]) => text)).toEqual([expect.stringContaining('VPN & Device Management')]);
        write.mockRestore();
    });

    test("reads no fix into the app's own output once devicectl launched it", () => {
        const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        openOnIosDevice('/x/demo.app', { device: DEVICE });

        apple.launched.stderr.emit('data', 'Launched application with com.example.demo bundle identifier.\n');
        apple.launched.stderr.emit('data', 'the app logs: the device was still locked\n');

        expect(write).not.toHaveBeenCalled();
        write.mockRestore();
    });

    test('ends the app as it ends devicectl, which passes the signal on', () => {
        const { close } = openOnIosDevice('/x/demo.app', { device: DEVICE });

        close();

        expect(apple.launched.kill).toHaveBeenCalledOnce();
    });
});
