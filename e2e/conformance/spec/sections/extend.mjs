// The methods a hand-written interface adds to a class with %extend, and the template instances it names with
// %template (native/confextend.h, confextend.i).
export function extendChecks({ add }, s) {
    add('extend:method', async () => (await new s.ConfExtended('Ada')).greet('Bob'), 'Ada greets Bob');
    add('extend:onSharedPointer', async () => (await s.ConfExtended.shared('Ada')).greet('Bob'), 'Ada greets Bob');
    add('extend:objectArgument', async () => {
        const ada = await new s.ConfExtended('Ada');
        return ada.greetBoth('Bob', await s.ConfExtended.shared('Eve'));
    }, 'Ada greets Bob and Eve');
    add('extend:cStringArgument', async () => (await new s.ConfExtended('Ada')).sizeWith('four'), 7);
    add('extend:overloadOfClassMethod', async () => {
        const ada = await new s.ConfExtended('Ada');
        return [await ada.size(), await ada.size(10), await ada.name()];
    }, [3, 13, 'Ada']);
    add('extend:staticMethod', () => s.ConfExtended.kind(), 'extended');
    add('extend:templateClass', async () => {
        const box = await new s.ConfTemplateBoxInt();
        await box.set(5);
        return box.get();
    }, 5);
    add('extend:templateFunction', () => s.confLargerInt(3, 8), 8);
}
