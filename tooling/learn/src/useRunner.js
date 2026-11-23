import { useRef, useState } from 'react';
import { compiled } from './compiled.js';
import { canRunPrebuilt, loadPrebuilt } from './prebuilt.js';
import { MAIN, compileRequest, scriptsOf } from './project.js';
import { runInSandbox } from './sandbox.js';

const MAX_LINES = 500;
export const UNREACHABLE = 'The playground service cannot be reached right now.';

// Runs a project's main.js in the sandboxed frame (sandbox.js) against a module: the sample's prebuilt one while it
// serves the project, otherwise one the playground compiler builds. The caller says where a sample's prebuilt module
// is (`prebuilt(sampleId)`, prebuilt.js), how a project compiles (`compile(request)`, which sends the project as a
// compile takes it and resolves to the compiler's answer, compiled.js) and whether it can now (`canCompile`).
export function useRunner({ compile, canCompile, prebuilt }) {
    const [phase, setPhase] = useState('idle');
    const [notice, setNotice] = useState(null);
    const [lines, setLines] = useState([]);
    const [buildLog, setBuildLog] = useState('');
    const [lastRun, setLastRun] = useState(null);
    const stopRun = useRef(null);
    const print = (line) => setLines((current) => [...current.slice(-(MAX_LINES - 1)), line]);

    function clear() {
        setLines([]);
        setBuildLog('');
        setNotice(null);
        setLastRun(null);
    }

    async function compileProject(project) {
        const answer = compiled(await compile(compileRequest(project)));
        if (answer.module) return answer.module;
        setBuildLog(answer.log ?? '');
        setNotice(answer.notice);
        return null;
    }

    async function run({ sampleId, project, original }) {
        const sample = prebuilt(sampleId);
        const fromPrebuilt = canRunPrebuilt(sample, project, original);
        if (phase !== 'idle' || !(fromPrebuilt || canCompile)) return;
        clear();
        const started = performance.now();
        setPhase(fromPrebuilt ? 'loading' : 'compiling');
        try {
            const module = fromPrebuilt ? await loadPrebuilt(sample) : await compileProject(project);
            if (!module) return;
            setPhase('running');
            const runner = runInSandbox({
                js: module.js, wasm: module.wasm, imports: module.imports, code: project.files[MAIN] ?? '', scripts: scriptsOf(project), onOutput: print,
            });
            stopRun.current = runner.stop;
            if (await runner.done === 'done') {
                print({ stream: 'done', text: '=> done' });
                setLastRun({ prebuilt: fromPrebuilt, seconds: (performance.now() - started) / 1000 });
            }
        } catch (error) {
            setNotice({ text: error.message || UNREACHABLE });
        } finally {
            stopRun.current = null;
            setPhase('idle');
        }
    }

    return {
        phase, notice, setNotice, lines, buildLog, lastRun, run, clear, stop: () => stopRun.current?.(),
    };
}
