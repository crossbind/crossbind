import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// docker answers as it would, or as a test's answer says; each Gradle run leaves the outputs its tasks make.
const calls = [];
const envs = [];
let answer = () => null;
const spawnSync = vi.fn((program, args, options) => {
    calls.push(args);
    envs.push(options?.env);
    const answered = answer(args);
    if (answered) return answered;
    const tasks = args.slice(args.indexOf('gradle'));
    const project = args[args.indexOf('-w') + 1]?.replace('/tmp/crossbind/live', base);
    const write = (file) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, file);
    };
    if (tasks.includes('assembleRelease')) write(`${project}/app/build/outputs/apk/release/app-release.apk`);
    if (tasks.includes('bundleRelease')) write(`${project}/app/build/outputs/bundle/release/app-release.aab`);
    return { status: 0, stdout: '', stderr: '' };
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));
vi.mock('../src/utils/pullDockerImage.js', () => ({ default: vi.fn(), getDockerImage: () => 'android-app-image' }));
vi.mock('../src/utils/getOsUserAndGroupId.js', () => ({ default: () => '1000:1000' }));
// The keychain keeps the passwords of the keys this map names.
const secrets = new Map();
vi.mock('../src/utils/keychain.js', () => ({ readSecret: (key) => secrets.get(key) ?? null }));

let base;
let home;
const state = { config: { paths: {} } };
vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('node:os', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, default: { ...real, homedir: () => home } };
});

const {
    SIGNING, buildApk, machineUploadKey, packageAndroidRelease, releaseSigning, uploadKeyEnv,
} = await import('../src/actions/androidGradle.js');
const { getContentHash } = await import('../src/utils/hash.js');
const { removeSecretFiles } = await import('../src/utils/secretFile.js');
afterAll(removeSecretFiles);

let keystore;

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-base-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-home-'));
    keystore = path.join(home, 'upload.jks');
    fs.writeFileSync(keystore, 'key');
    state.config.paths.base = base;
    state.config.paths.project = path.join(base, 'apps', 'demo');
    state.config.system = {};
    secrets.clear();
    calls.length = 0;
    envs.length = 0;
    answer = () => null;
    Object.values(SIGNING).forEach((name) => vi.stubEnv(name, ''));
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
});

const sign = () => {
    vi.stubEnv(SIGNING.keystore, keystore);
    vi.stubEnv(SIGNING.alias, 'upload');
    vi.stubEnv(SIGNING.password, 'secret-4711');
};

const runs = () => calls.filter((args) => args[0] === 'run');

// docker ps lists the development containers this machine has: one whose session has ended, one whose session runs.
const listContainers = (args) => (args[0] === 'ps' && args.includes('label=dev.crossbind.android-app.session')
    ? { status: 0, stdout: `crossbind-android-app-gone 4242\ncrossbind-android-app-live ${process.pid}\n`, stderr: '' }
    : null);
const endedSession = () => vi.spyOn(process, 'kill').mockImplementation((pid) => {
    if (pid === 4242) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    return true;
});
const removed = (name) => calls.findIndex((args) => args[0] === 'rm' && args.at(-1) === name);

describe("an Android release's upload key", () => {
    test('is none without a keystore, and the debug key signs', () => {
        expect(releaseSigning({})).toBeNull();
    });

    test('is all of the keystore, its alias and its password, or an error naming what is missing', () => {
        expect(() => releaseSigning({ [SIGNING.alias]: 'upload' })).toThrow(`${SIGNING.alias} is set without ${SIGNING.keystore}`);
        expect(() => releaseSigning({ [SIGNING.keystore]: keystore })).toThrow(`${SIGNING.alias} and ${SIGNING.password} are not`);
        expect(() => releaseSigning({ [SIGNING.keystore]: path.join(home, 'none.jks'), [SIGNING.alias]: 'a', [SIGNING.password]: 'p' }))
            .toThrow('which is no file');
        expect(releaseSigning({ [SIGNING.keystore]: keystore, [SIGNING.alias]: 'a', [SIGNING.password]: 'p', [SIGNING.keyPassword]: 'k' }))
            .toEqual({ file: keystore, names: [SIGNING.alias, SIGNING.password, SIGNING.keyPassword] });
    });

    test("is the keystore's base64 text in place of its file, as CI gives a secret", () => {
        const bytes = Buffer.from(Array.from({ length: 120 }, (_, index) => index));
        const text = bytes.toString('base64').replace(/(.{76})/g, '$1\n');
        const signing = releaseSigning({ [SIGNING.keystore]: text, [SIGNING.alias]: 'a', [SIGNING.password]: 'p' });
        expect(path.basename(path.dirname(signing.file))).toMatch(/^crossbind-secrets-/);
        expect(Buffer.compare(fs.readFileSync(signing.file), bytes)).toBe(0);
    });
});

describe('an Android release packaged in the android-app image', () => {
    test('signed with the upload key is an APK and a bundle, and no password reaches the command line', () => {
        sign();
        const project = path.join(base, 'dist', 'demo-android');

        packageAndroidRelease(project);

        const [args] = runs();
        expect(args.slice(0, 2)).toEqual(['run', '--rm']);
        expect(args).toEqual(expect.arrayContaining(['--network', 'none', '--platform', 'linux/amd64', '-w', '/tmp/crossbind/live/dist/demo-android']));
        expect(args).toContain(`${keystore}:/tmp/crossbind/keystore:ro`);
        expect(args).toContain(`${SIGNING.keystore}=/tmp/crossbind/keystore`);
        expect(args).toEqual(expect.arrayContaining([SIGNING.alias, SIGNING.password]));
        expect(args.join(' ')).not.toContain('secret-4711');
        expect(args.slice(-2)).toEqual(['assembleRelease', 'bundleRelease']);
        // Kotlin compiles in Gradle's own process, as no Kotlin daemon is found from the container's home /.
        expect(args).toContain('-Pkotlin.compiler.execution.strategy=in-process');
        expect(fs.existsSync(`${project}.apk`)).toBe(true);
        expect(fs.existsSync(`${project}.aab`)).toBe(true);
        expect(fs.existsSync(path.join(home, '.crossbind', 'android', 'home'))).toBe(true);
        expect(args.map(upath.toUnix)).toEqual(expect.arrayContaining([
            `${upath.join(home, '.crossbind', 'cache', 'android', 'gradle')}:/var/cache/crossbind/gradle`,
            `${upath.join(home, '.crossbind', 'android', 'home')}:/var/cache/crossbind/android`,
        ]));
    });

    test('without one is an APK signed with the debug key, a warning, and no bundle', () => {
        const project = path.join(base, 'dist', 'demo-android');
        fs.mkdirSync(path.dirname(project), { recursive: true });
        fs.writeFileSync(`${project}.aab`, 'an earlier bundle');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        packageAndroidRelease(project);

        expect(runs()[0].at(-1)).toBe('assembleRelease');
        expect(runs()[0].join(' ')).not.toContain('/tmp/crossbind/keystore');
        expect(fs.existsSync(`${project}.apk`)).toBe(true);
        expect(fs.existsSync(`${project}.aab`)).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("signed with this machine's debug key"));
        warn.mockRestore();
    });

    test("of a project whose extensions ask Maven for libraries resolves online, checked by the verification metadata it carries", () => {
        const project = path.join(base, 'dist', 'demo-android');
        fs.mkdirSync(path.join(project, 'gradle'), { recursive: true });
        fs.writeFileSync(path.join(project, 'gradle', 'verification-metadata.xml'), '<verification-metadata/>');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        packageAndroidRelease(project);

        expect(runs()[0]).toContain('assembleRelease');
        expect(runs()[0]).not.toContain('--offline');
        expect(runs()[0]).not.toContain('--network');
        warn.mockRestore();
    });

    test("is refused outside the project's base, which is all the container sees", () => {
        const elsewhere = path.join(home, 'dist', 'demo-android');

        expect(() => packageAndroidRelease(elsewhere)).toThrow(`the Android project ${elsewhere} is outside ${base}`);
        expect(calls).toHaveLength(0);
    });

    test('first removes the development containers of sessions that have ended, whose Gradle daemons hold its caches', () => {
        const project = upath.join(base, 'dist', 'demo-android');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const kill = endedSession();
        answer = listContainers;
        try {
            packageAndroidRelease(project);

            const release = calls.indexOf(runs()[0]);
            expect(removed('crossbind-android-app-gone')).toBeGreaterThan(-1);
            expect(removed('crossbind-android-app-gone')).toBeLessThan(release);
            expect(removed('crossbind-android-app-live')).toBe(-1);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('removing crossbind-android-app-gone'));
        } finally {
            kill.mockRestore();
            warn.mockRestore();
        }
    });

    test("that cannot take Gradle's caches names the development containers that hold them", () => {
        const project = upath.join(base, 'dist', 'demo-android');
        answer = (args) => {
            if (args[0] === 'ps' && args.includes('name=crossbind-android-app-')) return { status: 0, stdout: 'crossbind-android-app-b11fd8f6e5a1\n', stderr: '' };
            if (args[0] === 'run') return { status: 1, stdout: '', stderr: 'Timeout waiting to lock journal cache (/var/cache/crossbind/gradle/caches/journal-1). It is currently in use by another process.' };
            return null;
        };

        expect(() => packageAndroidRelease(project)).toThrow(/held by crossbind-android-app-b11fd8f6e5a1[\s\S]*docker rm --force crossbind-android-app-b11fd8f6e5a1/);
    });
});

describe('the debug APK of a development session', () => {
    test("builds in one container, whose Gradle daemon the session's builds share", () => {
        const project = path.join(base, '.crossbind', 'build', 'demo-android.debug');

        expect(buildApk(project)).toBe(path.join(project, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'));
        buildApk(project);

        const runs = calls.filter((args) => args[0] === 'run');
        const execs = calls.filter((args) => args[0] === 'exec');
        // The project's own name, not its base's, which other projects share; one a crashed session left behind gives
        // it up first.
        const name = `crossbind-android-app-${getContentHash(state.config.paths.project).slice(0, 12)}`;
        expect(calls.find((args) => args[0] === 'rm')).toEqual(['rm', '--force', name]);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toEqual(expect.arrayContaining(['--detach', '--name', name, '--network', 'none', '--user', '1000:1000', 'sleep', 'infinity']));
        expect(execs).toHaveLength(2);
        expect(execs[0]).toEqual(expect.arrayContaining(['-w', '/tmp/crossbind/live/.crossbind/build/demo-android.debug', 'assembleDebug']));
        expect(execs[0]).not.toContain('--no-daemon');
    });

    test('comes anew with the network once the project asks Maven for its extensions\' libraries, and builds online', () => {
        const project = path.join(base, '.crossbind', 'build', 'demo-android.debug');
        buildApk(project);
        fs.mkdirSync(path.join(project, 'gradle'), { recursive: true });
        fs.writeFileSync(path.join(project, 'gradle', 'verification-metadata.xml'), '<verification-metadata/>');
        buildApk(project);

        const runs = calls.filter((args) => args[0] === 'run');
        const execs = calls.filter((args) => args[0] === 'exec');
        expect(runs.at(-1)).toEqual(expect.arrayContaining(['--detach', 'sleep', 'infinity']));
        expect(runs.at(-1)).not.toContain('--network');
        expect(execs.at(-2)).toContain('--offline');
        expect(execs.at(-1)).not.toContain('--offline');
    });

    test('carries the PID of its session, and one a session left behind without its exit hooks goes before it starts', () => {
        const project = upath.join(base, '.crossbind', 'build', 'demo-android.debug');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const kill = endedSession();
        answer = listContainers;
        try {
            // One build or the other starts a container, whichever the last test's left needs the network or not.
            buildApk(project);
            fs.mkdirSync(upath.join(project, 'gradle'), { recursive: true });
            fs.writeFileSync(upath.join(project, 'gradle', 'verification-metadata.xml'), '<verification-metadata/>');
            buildApk(project);
        } finally {
            kill.mockRestore();
            warn.mockRestore();
        }

        const start = runs()[0];
        expect(start).toEqual(expect.arrayContaining(['--label', `dev.crossbind.android-app.session=${process.pid}`]));
        expect(removed('crossbind-android-app-gone')).toBeGreaterThan(-1);
        expect(removed('crossbind-android-app-gone')).toBeLessThan(calls.indexOf(start));
        expect(removed('crossbind-android-app-live')).toBe(-1);
    });
});

describe("this machine's upload key", () => {
    test("signs a release whose environment names no key, with the password the keychain keeps", () => {
        state.config.system = { ANDROID_KEYSTORE: keystore, ANDROID_KEY_ALIAS: 'upload' };
        secrets.set(keystore, 'kept-4711');
        const project = path.join(base, 'dist', 'demo-android');

        packageAndroidRelease(project);

        expect(runs()[0]).toContain(`${keystore}:/tmp/crossbind/keystore:ro`);
        expect(runs()[0]).toEqual(expect.arrayContaining([SIGNING.alias, SIGNING.password]));
        expect(runs()[0].join(' ')).not.toContain('kept-4711');
        expect(envs[calls.indexOf(runs()[0])]).toMatchObject({ [SIGNING.keystore]: keystore, [SIGNING.alias]: 'upload', [SIGNING.password]: 'kept-4711' });
        expect(fs.existsSync(`${project}.aab`)).toBe(true);
    });

    test("gives way to the environment's own key, and stops without its password", () => {
        const system = { ANDROID_KEYSTORE: keystore, ANDROID_KEY_ALIAS: 'upload' };
        expect(machineUploadKey({ [SIGNING.keystore]: '/elsewhere/own.jks' }, system)).toBeNull();
        expect(machineUploadKey({}, { ANDROID_KEYSTORE: '' })).toBeNull();
        expect(machineUploadKey({}, system)).toEqual({ keystore, alias: 'upload', password: null });
        expect(machineUploadKey({ [SIGNING.password]: 'given' }, system).password).toBe('given');
        expect(() => uploadKeyEnv({ keystore, alias: 'upload', password: null }))
            .toThrow(`this machine's upload key, ${keystore}, needs its password: set ${SIGNING.password}, or build on a terminal, which asks for it`);
        expect(uploadKeyEnv({ keystore, alias: 'upload', password: 'p' }))
            .toEqual({ [SIGNING.keystore]: keystore, [SIGNING.alias]: 'upload', [SIGNING.password]: 'p' });
    });
});

describe("an Android release's symbols zip", () => {
    test("is made beside the bundle by the image's jar, with each ABI's libraries at its root", () => {
        sign();
        const project = path.join(base, 'dist', 'demo-android');
        fs.mkdirSync(path.join(project, 'symbols', 'arm64-v8a'), { recursive: true });
        packageAndroidRelease(project);
        const zip = calls.find((args) => args.includes('jar'));
        expect(zip.slice(zip.indexOf('jar'))).toEqual(['jar', '--create', '--no-manifest', '--file', '../demo-android-symbols.zip', '-C', 'symbols', '.']);
        expect(zip).toEqual(expect.arrayContaining(['--network', 'none', '-w', '/tmp/crossbind/live/dist/demo-android']));
    });

    test('is not made without symbols, as a debug build keeps its libraries as they are', () => {
        const project = path.join(base, 'dist', 'demo-android');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        packageAndroidRelease(project);
        expect(calls.some((args) => args.includes('jar'))).toBe(false);
        vi.restoreAllMocks();
    });
});
