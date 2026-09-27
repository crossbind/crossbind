export const title = 'Expand entities without a billion laughs';
export const summary = 'Expat expands the entities a document declares and stops the ones that blow up: XML_SetBillionLaughsAttackProtectionMaximumAmplification and …ActivationThreshold set how far.';
export const native = 'xml_guard.h';
export const expected = [
    'crossbind parses crossbind',
    '5 levels: 300000 characters',
    '9 levels: limit on input amplification factor (from DTD and entities) breached at line 14, column 6',
    '5 levels, 64 KiB threshold: limit on input amplification factor (from DTD and entities) breached at line 10, column 6',
];

export default async function example({ XmlGuard }, console) {
    const MAX_AMPLIFICATION = 100; // Expat's defaults
    const THRESHOLD = 8 * 1024 * 1024;
    console.log(await XmlGuard.text('<!DOCTYPE note [<!ENTITY product "crossbind">]><note>&product; parses &product;</note>', MAX_AMPLIFICATION, THRESHOLD));

    // Each level repeats the one below ten times: 9 levels would expand to 3 GB.
    const laughs = (levels) => {
        const entities = ['<!ENTITY lol0 "lol">'];
        for (let level = 1; level <= levels; level += 1) entities.push(`<!ENTITY lol${level} "${`&lol${level - 1};`.repeat(10)}">`);
        return `<?xml version="1.0"?>\n<!DOCTYPE lolz [\n${entities.join('\n')}\n]>\n<lolz>&lol${levels};</lolz>`;
    };
    console.log('5 levels:', (await XmlGuard.text(laughs(5), MAX_AMPLIFICATION, THRESHOLD)).length, 'characters');
    try {
        await XmlGuard.text(laughs(9), MAX_AMPLIFICATION, THRESHOLD);
    } catch (error) {
        console.log('9 levels:', error.cppMessage ?? error.message);
    }
    try {
        await XmlGuard.text(laughs(5), MAX_AMPLIFICATION, 64 * 1024);
    } catch (error) {
        console.log('5 levels, 64 KiB threshold:', error.cppMessage ?? error.message);
    }
}
