import projWasi from '@crossbind/port-proj-wasi/crossbind.config.js';

export default {
    general: { name: 'proj-tool' },
    dependencies: [projWasi],
    // The program and the proj.db it reads land in dist/.
    paths: { config: import.meta.url, output: 'dist' },
};
