// The pthread bootstrap spawns its workers from _scriptName, which the glue captures from document.currentScript
// when it loads: undefined for a bridge loaded as a module script, so the workers fetch "/undefined" and a
// direct-mode mt init hangs. The spawn reads Module.crossbindMainScript first, which the browser adapter sets from
// paths.worker/paths.js (emscripten's own mainScriptUrlOrBlob trips emsdk 6 debug assertions on st targets).

// The release glue spells it `pthreadMainJs=_scriptName`, the debug glue `pthreadMainJs = _scriptName`.
const SPAWN = /pthreadMainJs\s*=\s*_scriptName/g;
const MAIN_SCRIPT = 'pthreadMainJs=Module["crossbindMainScript"]||_scriptName';

// Returns the rewritten glue and whether it spawns pthreads from a script this rewrite does not recognise.
export function spawnPthreadsFromMainScript(glue) {
    const text = glue.replace(SPAWN, MAIN_SCRIPT);
    return { text, missed: text.includes('pthreadMainJs') && !text.includes(MAIN_SCRIPT) };
}
