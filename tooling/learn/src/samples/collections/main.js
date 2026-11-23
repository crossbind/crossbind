import {
    initNative, sorted, wordLengths, invert,
} from './native/data.rs';

await initNative();

console.log(await sorted(['pear', 'apple', 'fig']));
console.log(await wordLengths('import a Rust file'));
console.log([...await invert(new Uint8Array([0, 64, 255]))]);
