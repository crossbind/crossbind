import {
    initNative, wordCount, Celsius,
} from './native/units.rs';

await initNative();

console.log('words:', await wordCount('import a Rust file'));

const today = await new Celsius(21.5);
console.log('in Fahrenheit:', await today.toFahrenheit());
