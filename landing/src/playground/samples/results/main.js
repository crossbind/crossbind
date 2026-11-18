import {
    initNative, firstLongWord, parseScore,
} from './native/words.rs';

await initNative();

console.log(await firstLongWord('import a Rust file', 5));
console.log(await firstLongWord('import a Rust file', 9));

for (const text of ['42', '250', 'abc']) {
    try {
        console.log(text, 'is', await parseScore(text));
    } catch (error) {
        console.log(text, 'throws', error.message);
    }
}
