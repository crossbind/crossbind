import {
    initNative, countLines, append,
} from './native/native.h';

const m = await initNative();
const path = '/memfs/todo.txt';

await m.FS.writeFile(path, 'bind\nbuild\n');
await append(path, 'ship');

console.log('lines:', await countLines(path));
console.log(await m.FS.readFile(path, { encoding: 'utf8' }));
