import fs from 'node:fs';
import path from 'node:path';

// The kinds of crossbind.config whose default export can be an object literal to write into, and which a command's
// runner (runtime/wasiRun.mjs) imports as they are; kept apart from configWriter.js so the runner loads no parser.
const CONFIG_EXTENSIONS = ['js', 'mjs', 'cjs'];

export const configFileOf = (project) => CONFIG_EXTENSIONS.map((extension) => path.join(project, `crossbind.config.${extension}`))
    .find((candidate) => fs.existsSync(candidate));
