import base from '@crossbind/port-geotiff/build.mjs';

export default {
    ...base,
    // The family recipe drops the utilities; this bin package keeps upstream's build intact.
    sourceReplaceList: () => [],
    bin: {
        tools: {
            listgeo: { kind: 'binary', publish: true },
            geotifcp: { kind: 'binary', publish: true },
            applygeo: { kind: 'binary', publish: true },
        },
    },
};
