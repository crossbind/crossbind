// A pointer a member function or property hands out can point into the object it was called on, as a getter of a
// member behind a unique_ptr does, or name that object, as a fluent call does. JavaScript frees the object once
// nothing reaches its handle (utils/embindObjectLifetime.js), and the pointer then reads freed memory. The handle of
// such a pointer holds a clone of the object's handle, on the count the pointer's clones share, so the object goes
// with the last of them. Only a raw pointer, a NativePointer and an emscripten::val can borrow: a copy and a smart
// pointer hold what they point at. Static methods and free functions have no object to hold.

const HELPERS = 'function crossbindMayBorrow(type){if(!type)return false;if(type.name==="emscripten::val")return true;'
    + 'var cls=type.registeredClass;return!!cls&&!type.isReference&&(!type.isSmartPointer||cls.name==="NativePointer")}'
    + 'function crossbindKeepOwner(value,owner){var $$=value&&value.$$;var held=owner&&owner.$$;'
    + 'if(!$$||!$$.count||$$.count.owner||!held||!held.ptr||held.preservePointerOnDelete||$$.count===held.count)return value;'
    + 'if($$.smartPtr?$$.ptrType.registeredClass.name==="NativePointer":!$$.count.owned)$$.count.owner=owner.clone();return value}'
    + 'function crossbindKeepsOwner(fn,type){if(!crossbindMayBorrow(type))return fn;'
    + 'var kept=function(...args){var owner=this;var value=fn.apply(owner,args);'
    + 'return value instanceof Promise?value.then(resolved=>crossbindKeepOwner(resolved,owner)):crossbindKeepOwner(value,owner)};'
    + 'Object.defineProperty(kept,"name",{value:fn.name});return kept}';

// The release glue spells each on one line, the debug glue with spaces and quoted property names. A release glue
// names embind's registrations by the minified keys of the wasm imports, so a glue that registers class methods is
// known by the pure virtual check of the method registration, and one that registers properties by the getter's
// `this` check.
const CRAFT = /function craftInvokerFunction\s*\(/;
const MEMBER = /(var memberFunction\s*=\s*)(craftInvokerFunction\(\s*humanName,\s*argTypes,\s*classType,\s*rawInvoker,\s*context(?:,\s*isAsync)?\s*\))(\s*;)/g;
const GETTER = /return (getterReturnType(?:\.fromWireType|\[['"]fromWireType['"]\])\(\s*getter\(\s*getterContext,\s*ptr\s*\)\s*\))/g;
const METHODS = /pureVirtualFunctions\.push\(\s*methodName\s*\)/;
const PROPERTIES = /humanName\s*\+\s*['"] getter['"]/;

const count = (text, pattern) => text.match(pattern)?.length ?? 0;

// Returns the rewritten glue and whether it binds class methods or properties this rewrite does not recognise.
export function keepPointerOwners(glue) {
    const hasMethods = METHODS.test(glue);
    const hasProperties = PROPERTIES.test(glue);
    if (!hasMethods && !hasProperties) return { text: glue, missed: false };
    const recognised = CRAFT.test(glue) && (!hasMethods || count(glue, MEMBER) === 1) && (!hasProperties || count(glue, GETTER) === 1);
    if (!recognised) return { text: glue, missed: true };
    const text = glue
        .replace(CRAFT, (craft) => `${HELPERS}${craft}`)
        .replace(MEMBER, (_, assign, call, end) => `${assign}crossbindKeepsOwner(${call},argTypes[0])${end}`)
        .replace(GETTER, (_, read) => `return crossbindKeepOwner(${read},this)`);
    return { text, missed: false };
}
