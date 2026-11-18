import {
    initNative, mean, split, countWords,
} from './native/native.h';

const m = await initNative();

console.log('mean:', await mean([3, 4, 8]));

const colors = await split('red,green,blue', ',');
console.log(await m.toArray(colors));

const counts = await countWords('the cat and the hat');
console.log('the:', await counts.get('the'));
