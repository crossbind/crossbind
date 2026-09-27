export const title = 'Choose a level, a checksum and a window';
export const summary = 'A context set up with ZSTD_CCtx_setParameter decides what every frame it writes looks like; ZSTD_getFrameHeader reads the choices back.';
export const native = 'zstd_frame.h';
export const expected = [
    'level 3: 16160 B -> 3065 B',
    'level 9: 16160 B -> 2749 B',
    'level 19: 16160 B -> 2219 B',
    'level 19, 1 KiB window, checksum: 2469 B',
    'content 16160 B, window 1024 B, checksum yes',
];

export default async function example({ ZstdFrame }, console) {
    let seed = 7;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const text = Array.from({ length: 400 }, (_, i) => `{"id":${i},"user":"user${random(5000)}","score":${random(1000)}}`).join('\n');
    for (const level of [3, 9, 19]) {
        const frame = await ZstdFrame.compress(text, level, false, 0);
        console.log(`level ${level}: ${text.length} B -> ${frame.length} B`);
    }
    const small = await ZstdFrame.compress(text, 19, true, 10);
    console.log(`level 19, 1 KiB window, checksum: ${small.length} B`);
    console.log(await ZstdFrame.header(small));
}
