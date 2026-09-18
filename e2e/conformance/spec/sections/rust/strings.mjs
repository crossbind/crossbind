// Rust strings: &str/&String params, owned String both ways, Option<String>, Option<&str>,
// &'static str and a Cow return; byte sequences cross as Uint8Array.
export function rustStringChecks({ add, todo }, s) {
    add('rs:str:strParam', () => s.confRsStrLen('héllo'), 5);
    add('rs:str:stringRefParam', () => s.confRsStringRefLen('abc'), 3);
    add('rs:str:ownedParam', () => s.confRsStringOwned('abc'), 'ABC');
    add('rs:str:unicode', () => s.confRsStringReverse('ab✓'), '✓ba');
    add('rs:str:optionSome', () => s.confRsStringOpt(true), 'some');
    add('rs:str:optionNone', () => s.confRsStringOpt(false), null);
    add('rs:str:optionParam', () => s.confRsStringOptParam(null), 'none');
    add('rs:str:optionStrParam', () => s.confRsStrOptParam('abcd'), 4);
    add('rs:str:staticStr', () => s.confRsStrStatic(), 'static');
    add('rs:str:cow', () => s.confRsStrCow('cow'), 'cow');
    add('rs:str:bytesIn', () => s.confRsBytesSum(new Uint8Array([1, 2, 3])), 6);
    add('rs:str:bytesOut', async () => Array.from(await s.confRsBytesMake(3)), [0, 1, 2]);
    add('rs:str:bytesOutTyped', async () => (await s.confRsBytesMake(2)) instanceof Uint8Array, true);
}
