// Linked with -sDYNAMIC_EXECUTION=0, embind's craftInvokerFunction keeps argsWired, invokerFuncArgs and
// destructors once per bound function, shared by all its calls. A call frees its arguments from there
// once it returns, or once its promise settles for an async (_JSPI) function, so a call started before
// then overwrites them and the earlier call frees the later call's arguments instead of its own, which
// leak: two pending calls of one _JSPI method, or a method called again from a JavaScript callback it
// runs. Emscripten 6.0.9 builds it this way, as did upstream main on 2026-09-30; this rewrite declares
// the three inside the invoker, so each call gets its own.

// The release glue spells it on one line, the debug glue one statement per line with an argument
// count check first.
const SHARED = /var argsWired\s*=\s*new Array\(expectedArgCount\);\s*var invokerFuncArgs\s*=\s*\[\];\s*var destructors\s*=\s*\[\];\s*var invokerFn\s*=\s*function\s*\(\.\.\.args\)\s*\{(\s*(?:checkArgCount\([^;]*\);\s*)?)destructors\.length\s*=\s*0;/g;
const PER_CALL = 'var invokerFn=function(...args){$1var argsWired=new Array(expectedArgCount);var invokerFuncArgs=[];var destructors=[];';
const SEPARATED = /var invokerFn\s*=\s*function\s*\(\.\.\.args\)\s*\{\s*(?:checkArgCount\([^;]*\);\s*)?var argsWired\s*=/;

// Returns the rewritten glue and whether it still holds an invoker this rewrite does not recognise.
export function separateCallArguments(glue) {
    const text = glue.replace(SHARED, PER_CALL);
    return { text, missed: text.includes('argsWired') && !SEPARATED.test(text) };
}
