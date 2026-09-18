import sqlite3Wasm from '@crossbind/port-sqlite3-wasm/crossbind.config.js';

export default {
    general: { name: 'panelsqlite' },
    dependencies: [sqlite3Wasm],
    paths: { config: import.meta.url },
};
