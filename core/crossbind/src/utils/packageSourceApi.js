import fs from 'node:fs';
import path from 'node:path';
import writeIfChanged from './writeIfChanged.js';
import logger from './logger.js';
import runPackageSource, { runProbe } from './runPackageSource.js';
import { printable } from './printableText.js';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Enough of a failed build's log to reach the error the tool ends it with.
const LOG_TAIL_LINES = 60;

const isText = (value) => typeof value === 'string' && !value.includes('\0');

// A file the tool left in the work directory, as text, or null where there is none. Recipes write there too, so
// a link, which could name any file the machine's user reads, is refused, as is a path that leaves the directory.
function readOwn(name, dir, segments) {
    const root = fs.realpathSync(dir);
    const relative = segments.every(isText) ? path.relative(root, path.join(root, ...segments)) : '';
    const file = path.join(root, relative);
    const isInside = relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    if (isInside && !fs.existsSync(file)) return null;
    if (!isInside || fs.realpathSync(file) !== file || !fs.statSync(file).isFile()) {
        throw new Error(`crossbind: ${name} reads ${printable(segments.join('/'))} from its work directory, which is no file of its own there: a link, a folder, or a path that leaves the directory.`);
    }
    return fs.readFileSync(file, 'utf8');
}

function assertRun(name, command, env) {
    if (!Array.isArray(command) || command.length === 0 || !command.every(isText)) {
        throw new Error(`crossbind: ${name}'s run takes a program and its arguments as a list of strings.`);
    }
    const isEnv = env !== null && typeof env === 'object' && !Array.isArray(env)
        && Object.entries(env).every(([key, value]) => ENV_NAME.test(key) && isText(value));
    if (!isEnv) throw new Error(`crossbind: ${name}'s run takes env as variable names with their text.`);
}

function runFailure(name, step, target, program, result, logFile) {
    if (result.error && result.error.code !== 'ENOBUFS') {
        return new Error(`crossbind: could not run ${program} for ${target.path} (${result.error.message}).`);
    }
    let ending = `failed (exit code ${result.status})`;
    if (result.error) ending = 'was stopped: it printed more than crossbind reads';
    else if (result.signal) ending = `was stopped by ${result.signal}`;
    // A tool that says why on stdout alone would end the message with nothing.
    const printed = `${result.stderr ?? ''}`.trim() ? result.stderr : result.stdout;
    const tail = printable(`${printed ?? ''}`).trim().split('\n').slice(-LOG_TAIL_LINES).join('\n');
    return new Error(`crossbind: ${name} ${step} for ${target.path} ${ending}.${logFile ? ` Its whole log is in ${logFile}.` : ''}\n${tail}`);
}

// What a package source's steps get of crossbind. In install, with a log file, `run` runs the source's tool
// where the target's packages build (its image, a remote runner, or the host where isLocal says so), in the
// run's work directory, and what the tool writes to stderr is the install's log. In inputs the work directory
// is the source's probe directory and only a tool of the host can be asked.
export default function packageSourceApi({
    source, config, target, work, logFile = null,
}) {
    const { name } = source;
    const isLocal = work.runner === 'LOCAL';
    const step = logFile ? 'install' : 'inputs';
    const log = [];

    function run(command, { env = {} } = {}) {
        assertRun(name, command, env);
        if (!logFile && !isLocal) {
            throw new Error(`crossbind: ${name}'s inputs runs ${command[0]}, which it can where api.isLocal is true alone: elsewhere the image says what runs.`);
        }
        const result = logFile ? runPackageSource(command, {
            source, config, target, work, env,
        }) : runProbe(command, { work, env });
        if (logFile) {
            log.push(`${result.stderr ?? ''}`);
            writeIfChanged(logFile, log.join(''));
        }
        if (result.error || result.status !== 0) throw runFailure(name, step, target, command[0], result, logFile);
        return Object.freeze({ stdout: `${result.stdout ?? ''}`, stderr: `${result.stderr ?? ''}` });
    }

    return Object.freeze({
        name,
        isLocal,
        logFile,
        work: Object.freeze({ dir: work.dir, path: work.toolPath, read: (...segments) => readOwn(name, work.dir, segments) }),
        store: Object.freeze({ dir: work.store, path: work.storePath }),
        log: (text) => logger.info(text),
        run,
    });
}
