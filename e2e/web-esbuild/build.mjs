import fs from 'node:fs';
import * as esbuild from 'esbuild';
import crossbind from 'crossbind';

await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'esm',
    outdir: 'dist',
    plugins: [crossbind()],
});
fs.copyFileSync('index.html', 'dist/index.html');
