// emscripten's embind hands an empty std::optional to JavaScript as undefined and reads null as a value, which a number
// cannot take, while embind-jsi, a C++ nullptr and Rust's None give null on every runtime. This rewrite makes an empty
// optional null and lets null stand for one, as undefined does. The type keeps its `optional` flag, with which embind
// lets a last argument be left out.

// The release glue spells it on one line, the debug glue with spaces, and a multithreaded build's debug glue across lines.
const OPTIONAL_TYPE = /Object\.assign\(\{\s*optional:\s*true\s*\},\s*EmValType\)/;
const NULL_OPTIONAL_TYPE = 'Object.assign({optional:true},EmValType,{'
    + 'fromWireType:handle=>{var value=EmValType.fromWireType(handle);return value===undefined?null:value},'
    + 'toWireType:(destructors,value)=>EmValType.toWireType(destructors,value===null?undefined:value)})';

// Returns the rewritten glue and whether it registers optionals this rewrite does not recognise.
export function emptyOptionalAsNull(glue) {
    if (!glue.includes('registerType(rawOptionalType')) return { text: glue, missed: false };
    const text = glue.replace(OPTIONAL_TYPE, () => NULL_OPTIONAL_TYPE);
    return { text, missed: text === glue };
}
