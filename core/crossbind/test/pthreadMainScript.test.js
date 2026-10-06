import { describe, test, expect } from 'vitest';
import { spawnPthreadsFromMainScript } from '../src/utils/pthreadMainScript.js';

// allocateUnusedWorker as emscripten 6.0.9 writes it into a release glue and, spaced over lines, into the debug glue
// the dev servers load.
const RELEASE = 'allocateUnusedWorker(){var worker;var pthreadMainJs=_scriptName;worker=new Worker(pthreadMainJs,{type:"module",name:"em-pthread"});';
const DEBUG = [
    '    allocateUnusedWorker() {',
    '      var worker;',
    '      var pthreadMainJs = _scriptName;',
    '      worker = new Worker(pthreadMainJs, {',
].join('\n');
const MAIN_SCRIPT = 'pthreadMainJs=Module["crossbindMainScript"]||_scriptName';

describe('spawnPthreadsFromMainScript', () => {
    test.each([['release', RELEASE], ['debug', DEBUG]])('a %s glue spawns its pthreads from Module.crossbindMainScript', (_, glue) => {
        const { text, missed } = spawnPthreadsFromMainScript(glue);

        expect(text).toContain(`var ${MAIN_SCRIPT};`);
        expect(text).not.toMatch(/pthreadMainJs\s*=\s*_scriptName/);
        expect(missed).toBe(false);
    });

    test('a glue it already rewrote stays as it is', () => {
        const { text } = spawnPthreadsFromMainScript(RELEASE);

        expect(spawnPthreadsFromMainScript(text)).toEqual({ text, missed: false });
    });

    test('reports a spawn it does not recognise, and ignores a glue without pthreads', () => {
        expect(spawnPthreadsFromMainScript('var pthreadMainJs=locateFile("x.js");').missed).toBe(true);
        expect(spawnPthreadsFromMainScript('var unrelated=1;')).toEqual({ text: 'var unrelated=1;', missed: false });
    });
});
