// A release build of embind passes whatever JavaScript hands an integer or enum parameter straight to
// the wire, where anything that is not a number becomes 0: an enum member given to an `int` parameter,
// a Number given to an enum parameter, a one-letter string given to a `char`. The call then runs with 0
// and reports no error. These rewrites convert what has one meaning and throw a TypeError for the rest,
// as embind's assertion builds do.

const GUARDS = [
    {
        registration: '_embind_register_integer',
        from: 'toWireType:(destructors,value)=>value,readValueFromPointer:integerReadValueFromPointer(',
        to: 'toWireType:(destructors,value)=>{'
            + 'if(typeof value=="number"||typeof value=="boolean"||typeof value=="bigint")return value;'
            + 'if(typeof value=="string"&&size==1&&value.length==1)return value.charCodeAt(0);'
            + 'if(value!==null&&typeof value=="object"&&typeof value.value=="number")return value.value;'
            + 'throw new TypeError(name+" takes a number, got "+(typeof value=="string"?JSON.stringify(value):value===null?"null":typeof value))'
            + '},readValueFromPointer:integerReadValueFromPointer(',
    },
    {
        registration: '_embind_register_enum',
        from: 'toWireType:(destructors,c)=>c.value,',
        to: 'toWireType:(destructors,c)=>{'
            + 'if(typeof c=="number")return c;'
            + 'if(c!==null&&typeof c=="object"&&typeof c.value=="number")return c.value;'
            + 'throw new TypeError(name+" takes a member of the enum or its number, got "+(typeof c=="string"?JSON.stringify(c):c===null?"null":typeof c))'
            + '},',
    },
];

// The release glue spells the bigint conversion `typeof value=="number"`, the debug glue `typeof value == 'number'`.
const BIGINT_FROM_NUMBER = /if\s*\(\s*typeof value\s*==\s*["']number["']\s*\)\s*\{\s*value\s*=\s*BigInt\(value\)\s*;?\s*\}/g;
const SAFE_BIGINT_FROM_NUMBER = 'if(typeof value=="number"){if(!Number.isSafeInteger(value))throw new TypeError("a 64-bit integer parameter takes a BigInt or a safe integer Number, got "+value);value=BigInt(value)}';

// Returns the rewritten glue and whether a bigint registration kept a conversion this rewrite does not recognise.
export function guardBigIntArguments(glue) {
    const text = glue.replace(BIGINT_FROM_NUMBER, SAFE_BIGINT_FROM_NUMBER);
    return { text, missed: text.includes('_embind_register_bigint') && !text.includes('Number.isSafeInteger(value)') };
}

// The debug glue the dev servers load spells both registrations over lines, and its integer conversion already
// throws for anything but a number or a boolean, so the member and character conversions go ahead of that check.
// Each applies inside its own registration only: the debug float conversion reads the same as the integer one.
const DEBUG_GUARDS = [
    {
        registration: '__embind_register_integer',
        end: 'readValueFromPointer: integerReadValueFromPointer(',
        from: /toWireType: \(destructors, value\) => \{(\s*)(?=if \(typeof value != ["']number["'])/,
        to: 'toWireType: (destructors, value) => {$1'
            + 'if (typeof value == "string" && size == 1 && value.length == 1) value = value.charCodeAt(0);$1'
            + 'if (value !== null && typeof value == "object" && typeof value.value == "number") value = value.value;$1',
        applied: 'value = value.charCodeAt(0);',
    },
    {
        registration: '__embind_register_enum',
        end: 'readValueFromPointer: enumReadValueFromPointer(',
        from: /toWireType: \(destructors, c\) => c\.value,/,
        to: 'toWireType: (destructors, c) => {'
            + 'if (typeof c == "number") return c;'
            + 'if (c !== null && typeof c == "object" && typeof c.value == "number") return c.value;'
            + 'throw new TypeError(name + " takes a member of the enum or its number, got " + (typeof c == "string" ? JSON.stringify(c) : c === null ? "null" : typeof c))'
            + '},',
        applied: 'takes a member of the enum or its number',
    },
];

function guardDebugRegistration(glue, { registration, end, from, to, applied }) {
    const start = glue.indexOf(`var ${registration} = `);
    const stop = start < 0 ? -1 : glue.indexOf(end, start);
    if (stop < 0) return { text: glue, missed: false };
    const code = glue.slice(start, stop);
    if (code.includes(applied)) return { text: glue, missed: false };
    const rewritten = code.replace(from, to);
    return { text: glue.slice(0, start) + rewritten + glue.slice(stop), missed: rewritten === code };
}

// Returns the rewritten glue and the registrations whose code no longer looks the way these rewrites expect.
export function guardEmbindArguments(glue) {
    const missed = GUARDS.filter(({ registration, from, to }) => glue.includes(`${registration}=`) && !glue.includes(from) && !glue.includes(to))
        .map(({ registration }) => registration);
    const released = GUARDS.reduce((current, { from, to }) => current.split(from).join(to), glue);
    return DEBUG_GUARDS.reduce(({ text, missed: names }, guard) => {
        const result = guardDebugRegistration(text, guard);
        return { text: result.text, missed: result.missed ? [...names, guard.registration] : names };
    }, { text: released, missed });
}
