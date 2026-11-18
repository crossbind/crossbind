import {
    initNative, indexOf, parsePercent,
} from './native/native.h';

await initNative();

const s = await indexOf('crossbind', 's');
const z = await indexOf('crossbind', 'z');
console.log('s is at', s);
console.log('z is at', z ?? 'no place');

for (const text of ['42', '250']) {
    try {
        console.log(text, 'is', await parsePercent(text));
    } catch (error) {
        console.log(text, 'throws', error.message);
    }
}
