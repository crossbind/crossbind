import base from '@crossbind/port-tiff/build.mjs';

export default {
    ...base,
    getBuildParams: (target, depPaths) => [
        ...base.getBuildParams(target, depPaths).filter((p) => p !== '-Dtiff-tools=OFF'),
        '-Dtiff-tools=ON',
    ],
    bin: {
        tools: {
            fax2ps: { kind: 'binary', publish: true },
            fax2tiff: { kind: 'binary', publish: true },
            pal2rgb: { kind: 'binary', publish: true },
            ppm2tiff: { kind: 'binary', publish: true },
            raw2tiff: { kind: 'binary', publish: true },
            tiff2bw: { kind: 'binary', publish: true },
            tiff2pdf: { kind: 'binary', publish: true },
            tiff2ps: { kind: 'binary', publish: true },
            tiff2rgba: { kind: 'binary', publish: true },
            tiffcmp: { kind: 'binary', publish: true },
            tiffcp: { kind: 'binary', publish: true },
            tiffcrop: { kind: 'binary', publish: true },
            tiffdither: { kind: 'binary', publish: true },
            tiffdump: { kind: 'binary', publish: true },
            tiffinfo: { kind: 'binary', publish: true },
            tiffmedian: { kind: 'binary', publish: true },
            tiffset: { kind: 'binary', publish: true },
            tiffsplit: { kind: 'binary', publish: true },
        },
    },
};
