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

// Returns the rewritten glue and the registrations whose code no longer looks the way these rewrites expect.
export function guardEmbindArguments(glue) {
    const missed = GUARDS.filter(({ registration, from, to }) => glue.includes(`${registration}=`) && !glue.includes(from) && !glue.includes(to))
        .map(({ registration }) => registration);
    const text = GUARDS.reduce((current, { from, to }) => current.split(from).join(to), glue);
    return { text, missed };
}
