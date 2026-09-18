import { rejecting } from './expect.mjs';

// const char* as a string both ways, std::string and std::u16string (native/conftext.h).
export function stringChecks({ add }, s) {
    const rejects = rejecting(add);
    add('str:staticReturn', () => s.confStrVersion(), '1.2.3');
    add('str:nullReturn', () => s.confStrNull(), null);
    add('str:staticMethod', () => s.ConfStrBox.kind(), 'box');
    add('str:param', () => s.confStrLength('abc'), 3);
    add('str:utf8RoundTrip', () => s.confStrEcho('héllo wörld ✓'), 'héllo wörld ✓');
    add('str:nullParam', () => s.confStrLength(null), -1);
    add('str:typedefChar', async () => [await s.confStrTypedef(), await s.confStrTypedefLength('abcd')], ['typedef', 4]);
    add('str:undefinedParam', () => s.confStrLength(undefined), -1);
    add('str:topLevelConst', () => s.confStrLengthConst('ab'), 2);
    add('str:arrayForm', () => s.confStrLengthArray('a'), 1);
    rejects('str:numberRejected', () => s.confStrLength(42), /string, a pointer handle or null/);
    rejects('str:objectRejected', () => s.confStrLength({}), /string, a pointer handle or null/);
    add('str:stdString', () => s.confStrUpper('abc'), 'ABC');
    add('str:bytesOut', async () => [...(await s.confStrBytes(3))].map((unit) => unit.charCodeAt(0)), [250, 251, 252]);
    add('str:bytesIn', () => s.confStrByteSum('úû'), 501);
    add('str:classCtorGetter', async () => (await new s.ConfStrBox('box1')).name(), 'box1');
    add('str:classSetter', async () => {
        const box = await new s.ConfStrBox('a');
        await box.rename('b');
        return box.name();
    }, 'b');
    add('str:classNullName', async () => (await new s.ConfStrBox(null)).name(), '');
    add('str:handleParam', async () => s.confStrLength(await s.cstring('abcd')), 4);
    add('str:bufferParam', async () => {
        const b = await s.allocBuffer(4);
        await s.confStrFill(b, 4);
        return s.confStrLength(b);
    }, 3);
    add('str:charReturnStaysHandle', async () => {
        const copy = await s.confStrDup('dup');
        const text = await s.readCString(copy);
        await s.confStrFree(copy);
        return text;
    }, 'dup');
    add('str:outBuffer', async () => {
        const b = await s.allocBuffer(6);
        await s.confStrFill(b, 6);
        return s.readCString(b);
    }, 'abcde');
    add('str:unsignedCharHandle', async () => {
        const b = await s.allocBuffer(1);
        await s.writeBytes(b, 'A');
        return s.confStrFirstByte(b);
    }, 65);
    rejects('str:unsignedCharStringRejected', () => s.confStrFirstByte('A'), /./);
}
