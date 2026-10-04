import fs from 'node:fs';
import path from 'node:path';

// A read-only directory cannot be emptied, so `rm -rf`, a restage and the cleanup of a conan run
// would all fail on one. fs.cpSync gives each directory it makes its source's mode. Links are left
// alone: they can point anywhere.
export default function makeTreeWritable(dir) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory()) return;
    fs.chmodSync(dir, stat.mode | 0o700);
    fs.readdirSync(dir).forEach((name) => makeTreeWritable(path.join(dir, name)));
}
