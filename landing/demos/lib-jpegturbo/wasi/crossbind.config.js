import jpegturboWasi from '@crossbind/port-jpegturbo-wasi/crossbind.config.js';

export default {
    general: { name: 'jpeg-tool' },
    dependencies: [jpegturboWasi],
    paths: { config: import.meta.url },
};
