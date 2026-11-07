import { useEffect, useRef, useState } from 'react';
import {
    deleteAccount, fetchSession, requestCompile, signOut, turnstileToken,
} from './client.js';
import { hasPrebuilt, loadPrebuilt } from './prebuilt.js';
import {
    MAIN, compileRequest, scriptsOf, servesProject,
} from './project.js';
import { runInSandbox } from './sandbox.js';

const MAX_LINES = 500;
const UNREACHABLE = 'The playground service cannot be reached right now.';
const DELETE_QUESTION = 'Delete your crossbind cloud account? This signs you out here and on every machine where crossbind login used it.';
const FAILURE_NOTICES = Object.freeze({
    compile: 'The build failed; its log is in the console.',
    timeout: 'The compile ran out of time.',
    memory: 'The compile ran out of memory.',
    output: 'The build printed too much or left no module.',
});

// The sample's prebuilt module stands in for a compile while it serves the project (project.js).
export const canRunPrebuilt = (sampleId, project, original) => servesProject(project, original) && hasPrebuilt(sampleId);

// Runs a project's main.js in the sandboxed frame (sandbox.js) against a module: the sample's prebuilt one while it
// serves the project, otherwise one the playground server compiles. Also holds the session that compiles count
// against, which a `lazy` page asks the server for only once it calls `connect`, when its project first needs a
// compile.
export function useRunner({ lazy = false } = {}) {
    const [session, setSession] = useState(null);
    const [phase, setPhase] = useState('idle');
    const [notice, setNotice] = useState(null);
    const [lines, setLines] = useState([]);
    const [buildLog, setBuildLog] = useState('');
    const [lastRun, setLastRun] = useState(null);
    const check = useRef(null);
    const stopRun = useRef(null);
    const connected = useRef(false);
    const reloadSession = () => fetchSession().then(setSession, () => setSession({ error: UNREACHABLE }));
    const print = (line) => setLines((current) => [...current.slice(-(MAX_LINES - 1)), line]);
    const canCompile = Boolean(session) && !session.error && session.enabled;

    function connect() {
        if (connected.current) return;
        connected.current = true;
        reloadSession();
    }

    useEffect(() => {
        if (!lazy) connect();
    }, []);

    function clear() {
        setLines([]);
        setBuildLog('');
        setNotice(null);
        setLastRun(null);
    }

    async function compile(project) {
        const turnstile = session.user ? undefined : await turnstileToken(check.current, session.turnstileSiteKey);
        const result = await requestCompile(compileRequest(project), turnstile);
        if (typeof result.remaining === 'number') setSession((current) => ({ ...current, remaining: result.remaining }));
        if (result.status !== 200) {
            setNotice({ text: result.error ?? `The playground answered ${result.status}.`, login: Boolean(result.login) });
            return null;
        }
        if (!result.ok) {
            setBuildLog(result.log ?? '');
            setNotice({ text: FAILURE_NOTICES[result.reason] ?? 'The build failed.' });
            return null;
        }
        return result;
    }

    async function run({ sampleId, project, original }) {
        const prebuilt = canRunPrebuilt(sampleId, project, original);
        if (phase !== 'idle' || !(prebuilt || canCompile)) return;
        clear();
        const started = performance.now();
        setPhase(prebuilt ? 'loading' : 'compiling');
        try {
            const module = prebuilt ? await loadPrebuilt(sampleId) : await compile(project);
            if (!module) return;
            setPhase('running');
            const runner = runInSandbox({
                js: module.js, wasm: module.wasm, imports: module.imports, code: project.files[MAIN] ?? '', scripts: scriptsOf(project), onOutput: print,
            });
            stopRun.current = runner.stop;
            if (await runner.done === 'done') {
                print({ stream: 'done', text: '=> done' });
                setLastRun({ prebuilt, seconds: (performance.now() - started) / 1000 });
            }
        } catch (error) {
            setNotice({ text: error.message || UNREACHABLE });
        } finally {
            stopRun.current = null;
            setPhase('idle');
        }
    }

    async function leave() {
        await signOut().catch(() => undefined);
        reloadSession();
    }

    async function removeAccount() {
        if (!window.confirm(DELETE_QUESTION)) return;
        const response = await deleteAccount().catch(() => null);
        setNotice({ text: response?.ok ? 'Your crossbind cloud account is deleted, and every machine is signed out of it.' : 'The account could not be deleted; try again.' });
        reloadSession();
    }

    return {
        session, phase, notice, setNotice, lines, buildLog, lastRun, check, canCompile, connect, run, clear, stop: () => stopRun.current?.(), leave, removeAccount,
    };
}
