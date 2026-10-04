import fs from 'node:fs';

// macOS keeps the code signature of a loaded binary per inode: a rebuilt addon or command copied over
// one that already ran gets the next process that loads it killed. A new file gets a new inode.
export default function replaceFile(source, destination) {
    fs.rmSync(destination, { force: true });
    fs.copyFileSync(source, destination);
}
