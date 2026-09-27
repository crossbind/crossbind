import tiffWasi from '@crossbind/port-tiff-wasi/crossbind.config.js';

export default {
    general: { name: 'tiff-tool' },
    dependencies: [tiffWasi],
    paths: { config: import.meta.url },
};
