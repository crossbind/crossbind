// JSPI suspends a call's wasm frames, but its C stack frames stay on the one stack every call of the module shares,
// and Emscripten 6.0.9 gives a suspended call no stack of its own: a call that resumes after a later one started
// returns over that one's frames, which the later one still uses. This rewrite runs the module's async (_JSPI)
// bindings one at a time, as Asyncify runs its async operations: a call made while another is pending enters wasm
// once that one settles. embind still converts the arguments when the call is made, so a wrong one throws there.

// The release glue spells it on one line, the debug glue across lines.
const PROMISING = /rtn\s*=\s*WebAssembly\.promising\(rtn\)/g;
const QUEUED = 'rtn=crossbindJspiQueue(WebAssembly.promising(rtn))';
const REQUIRE_FUNCTION = /var embind__requireFunction\s*=/;
// Declared in the module factory, so each instance queues on its own, as each has its own C stack.
const QUEUE = 'var crossbindJspiQueue=(()=>{var pending=null;return fn=>(...args)=>{'
    + 'var call=pending?pending.then(()=>fn(...args)):fn(...args);'
    + 'var settled=pending=call.then(()=>{},()=>{});'
    + 'settled.then(()=>{if(pending===settled)pending=null});'
    + 'return call}})();';

// Returns the rewritten glue and whether it holds a promising export this rewrite does not recognise.
export function queueJspiCalls(glue) {
    const text = glue.replace(PROMISING, QUEUED);
    if (text === glue || !REQUIRE_FUNCTION.test(text)) {
        return { text: glue, missed: glue.includes('WebAssembly.promising(rtn') && !glue.includes(QUEUED) };
    }
    return { text: text.replace(REQUIRE_FUNCTION, (declaration) => `${QUEUE}${declaration}`), missed: false };
}
