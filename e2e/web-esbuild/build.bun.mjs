import crossbind from 'crossbind';

const result = await Bun.build({
    entrypoints: ['./src/main.js'],
    outdir: './dist-bun',
    plugins: [crossbind()],
});
if (!result.success) {
    console.error(result.logs.join('\n'));
    process.exit(1);
}
await Bun.write('./dist-bun/index.html', Bun.file('./index.html'));
