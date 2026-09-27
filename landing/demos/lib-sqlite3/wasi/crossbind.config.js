import sqlite3Wasi from '@crossbind/port-sqlite3-wasi/crossbind.config.js';

export default {
    general: { name: 'sqlite-tool' },
    dependencies: [sqlite3Wasi],
    paths: { config: import.meta.url },
};
