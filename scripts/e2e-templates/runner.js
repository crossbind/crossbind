/**
 * Runs one template end-to-end: scaffold -> install -> build -> e2e.
 *
 * The recipe adapts to what the *scaffolded* package.json actually exposes:
 *   - build runs only if a `build` script exists and the build caps are present
 *   - web/cloud e2e runs `e2e:prod` (falls back to `e2e:dev`) after installing
 *     Playwright browsers
 *   - mobile picks `e2e:ios` (macOS + simulator) or `e2e:android` (attached
 *     emulator), both gated on Maestro and run WITHOUT CI (so `expo run:ios`
 *     exits instead of attaching to Metro); with no device/Maestro, Expo falls
 *     back to an `expo prebuild` smoke
 *   - backend / lib-source / lib-cmake have no e2e; their build (or just a clean
 *     scaffold+install) is the assertion
 *
 * Missing capabilities produce a SKIP (with reason), never a hard failure, so
 * the same harness is meaningful on a laptop and on CI.
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { run, MINUTE } = require('./exec');
const { missingCaps } = require('./env');

// OS-assigned free port: unique per template, immune to whatever already listens
// on the shared preview defaults (4173/3000).
function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, () => {
            const { port } = server.address();
            server.close(() => resolve(String(port)));
        });
    });
}

const TIMEOUTS = {
    scaffold: 5 * MINUTE,
    install: 15 * MINUTE,
    build: 30 * MINUTE,
    e2e: 30 * MINUTE,
};

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

// Which e2e script to run for a given class, plus the caps it needs. Returns
// null when the template has no browser/device e2e flow.
function pickE2e(scripts, klass, caps) {
    if (klass === 'web' || klass === 'cloud') {
        if (scripts['e2e:prod']) return { script: 'e2e:prod', needs: ['docker'] };
        if (scripts['e2e:dev']) return { script: 'e2e:dev', needs: ['docker'] };
        return null;
    }
    if (klass === 'mobile') {
        if (caps.ios && caps.maestro && scripts['e2e:ios']) return { script: 'e2e:ios', needs: ['ios', 'maestro', 'cocoapods'] };
        if (caps.androidDevice && caps.maestro && scripts['e2e:android']) return { script: 'e2e:android', needs: ['androidDevice', 'maestro'] };
        return null;
    }
    return null;
}

async function runTemplate(item, ctx) {
    const { baseDir, logDir, source, caps, pm, flags } = ctx;
    const projectDir = path.join(baseDir, item.name);
    const logFile = path.join(logDir, `${item.key}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'w' });
    const steps = [];
    // pnpm is lenient on peer ranges; a separate `npm install --dry-run` probe catches the
    // ERESOLVE conflicts a real npm user would hit. A failed probe fails the template.
    let npmPeerOk = true;

    const done = (status, reason) => {
        logStream.end();
        if (status !== 'fail' && !npmPeerOk) {
            return {
                key: item.key,
                klass: item.klass,
                status: 'fail',
                reason: reason ? `${reason}; npm peer conflict` : 'npm install peer conflict (ERESOLVE); pnpm ok',
                steps,
                logFile,
                projectDir,
            };
        }
        return {
            key: item.key,
            klass: item.klass,
            status,
            reason,
            steps,
            logFile,
            projectDir,
        };
    };
    const record = async (name, command, args, opts = {}) => {
        const r = await run(command, args, { logStream, label: name, ...opts });
        steps.push({
            name,
            status: r.ok ? 'pass' : 'fail',
            ms: r.ms,
            code: r.code,
        });
        return r;
    };
    const skip = (name, reason) => steps.push({ name, status: 'skip', reason });

    try {
        fs.rmSync(projectDir, { recursive: true, force: true });

        const inv = source.invoke(item.scaffoldArgs);
        const scaffold = await record('scaffold', inv.command, inv.args, { cwd: baseDir, timeoutMs: TIMEOUTS.scaffold });
        if (!scaffold.ok) return done('fail', 'scaffold failed');

        const pkg = readJson(path.join(projectDir, 'package.json'));
        if (!pkg) return done('fail', 'no package.json after scaffold');
        const scripts = pkg.scripts || {};

        // Catch npm peer conflicts (ERESOLVE) that pnpm would silently tolerate. Skipped when the
        // chosen pm is already npm (the install step below covers it) or via --skip-npm-check.
        if (pm !== 'npm' && !flags.skipNpmCheck) {
            const npmCheck = await record('npm-check', 'npm', ['install', '--dry-run', '--no-audit', '--no-fund', '--ignore-scripts'], {
                cwd: projectDir,
                timeoutMs: TIMEOUTS.install,
            });
            npmPeerOk = npmCheck.ok;
        }

        // --ignore-workspace: the scaffolded project lives under the repo's tmp/, so pnpm would
        // otherwise pick up the monorepo workspace. We want a true standalone install from npm.
        // A template that ships its own pnpm-workspace.yaml (build-script allowances) is already a
        // standalone root, and the flag would discard that file along with the monorepo's.
        const ownWorkspace = fs.existsSync(path.join(projectDir, 'pnpm-workspace.yaml'));
        const installArgs = pm === 'pnpm' && !ownWorkspace ? ['install', '--ignore-workspace'] : ['install'];
        const install = await record('install', pm, installArgs, { cwd: projectDir, timeoutMs: TIMEOUTS.install });
        if (!install.ok) return done('fail', 'install failed');

        let buildBlocked = false;
        if (scripts.build && !flags.skipBuild) {
            const miss = missingCaps(item.buildCaps, caps);
            if (miss.length) {
                skip('build', `missing ${miss.join(', ')}`);
                buildBlocked = true;
            } else {
                const build = await record('build', pm, ['run', 'build'], { cwd: projectDir, timeoutMs: TIMEOUTS.build });
                if (!build.ok) return done('fail', 'build failed');
            }
        }

        if (flags.skipE2e) return done('pass', 'e2e skipped');

        const e2e = pickE2e(scripts, item.klass, caps);
        if (!e2e) {
            // Expo with no attached device/Maestro: a prebuild smoke still proves the
            // config plugin generates the native project.
            if (item.key === 'mobile-reactnative-expo') {
                const pre = await record('expo-prebuild', 'npx', ['--yes', 'expo', 'prebuild', '--no-install'], {
                    cwd: projectDir,
                    timeoutMs: TIMEOUTS.build,
                });
                return pre.ok ? done('pass', 'prebuild smoke (no device for full e2e)') : done('fail', 'expo prebuild failed');
            }
            const reason = scripts.build ? undefined : 'no build/e2e scripts (scaffold+install only)';
            return done('pass', reason);
        }
        if (buildBlocked) {
            skip('e2e', 'build skipped');
            return done('skip', 'build caps missing');
        }
        const missE2e = missingCaps(e2e.needs, caps);
        if (missE2e.length) {
            skip('e2e', `missing ${missE2e.join(', ')}`);
            return done('skip', `e2e needs ${missE2e.join(', ')}`);
        }

        if (item.klass === 'web' || item.klass === 'cloud') {
            const pwArgs = ['--yes', 'playwright', 'install'];
            if (caps.platform === 'linux') pwArgs.push('--with-deps');
            // Browser install failures are surfaced by the e2e run itself, so don't hard-fail here.
            await record('playwright-install', 'npx', pwArgs, { cwd: projectDir, timeoutMs: TIMEOUTS.install });
        }

        // Expo ships no native project (nativeFolders:false). `expo run:ios` would
        // prebuild implicitly on first launch; do it explicitly up front so the native
        // project is guaranteed to exist before the build.
        if (item.key === 'mobile-reactnative-expo') {
            const platform = e2e.script === 'e2e:android' ? 'android' : 'ios';
            const pre = await record('expo-prebuild', 'npx', ['--yes', 'expo', 'prebuild', '-p', platform, '--no-install'], {
                cwd: projectDir,
                timeoutMs: TIMEOUTS.build,
            });
            if (!pre.ok) return done('fail', 'expo prebuild failed');
        }

        // Mirrors the iOS CI: a freshly scaffolded RN CLI project has no Pods/ until
        // `pod install` runs. Expo is excluded — its own `run:ios` installs pods the
        // expo way (a plain `pod install` here would diverge from that proven path).
        if (e2e.script === 'e2e:ios' && item.key !== 'mobile-reactnative-expo' && fs.existsSync(path.join(projectDir, 'ios', 'Podfile'))) {
            const pod = await record('pod-install', 'pod', ['install'], { cwd: path.join(projectDir, 'ios'), timeoutMs: TIMEOUTS.install });
            if (!pod.ok) return done('fail', 'pod install failed');
        }

        // CI=1 makes Playwright run headless for web/cloud. It is harmful for mobile:
        // under CI, `expo run:ios` starts Metro in CI mode and attaches (never exits),
        // so the `run:ios && maestro` chain hangs. Run mobile e2e without CI — exactly
        // how a developer runs `npm run e2e:ios` locally.
        // Each web/cloud template also gets a fresh OS-assigned port (CROSSBIND_E2E_PORT):
        // the shared preview defaults race with the previous template's teardown and
        // with anything already listening on the host.
        let e2eEnv;
        if (item.klass === 'web' || item.klass === 'cloud') {
            const e2ePort = await getFreePort();
            logStream.write(`[e2e-templates] CROSSBIND_E2E_PORT=${e2ePort}\n`);
            e2eEnv = { CI: '1', CROSSBIND_E2E_PORT: e2ePort };
        }
        const e2eRun = await record(`e2e:${e2e.script.replace('e2e:', '')}`, pm, ['run', e2e.script], {
            cwd: projectDir,
            timeoutMs: TIMEOUTS.e2e,
            env: e2eEnv,
        });
        if (!e2eRun.ok) return done('fail', `${e2e.script} failed`);

        return done('pass');
    } catch (err) {
        logStream.write(`\n[e2e-templates] runner error: ${err.stack || err}\n`);
        skip('runner', err.message);
        return done('fail', err.message);
    }
}

module.exports = { runTemplate, pickE2e };
