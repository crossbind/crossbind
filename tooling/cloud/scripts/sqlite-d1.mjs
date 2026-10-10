// The part of the D1 client the accounts use (worker/accounts.js), over node:sqlite with the migrations applied:
// for tests and the local API.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

export function sqliteD1(file = ':memory:') {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys = ON');
    fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()
        .forEach((name) => db.exec(fs.readFileSync(new URL(name, MIGRATIONS), 'utf8')));

    const statement = (sql, params = []) => ({
        bind: (...values) => statement(sql, values),
        async first(column) {
            const row = db.prepare(sql).get(...params);
            if (row === undefined) return null;
            return column === undefined ? { ...row } : row[column];
        },
        async all() {
            return { success: true, results: db.prepare(sql).all(...params).map((row) => ({ ...row })) };
        },
        async run() {
            const { changes } = db.prepare(sql).run(...params);
            return { success: true, meta: { changes } };
        },
    });

    return {
        prepare: (sql) => statement(sql),
        // D1 runs a batch as one transaction.
        async batch(statements) {
            db.exec('BEGIN');
            try {
                const results = [];
                for (const each of statements) results.push(await each.all());
                db.exec('COMMIT');
                return results;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },
    };
}
