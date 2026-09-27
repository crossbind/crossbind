export const title = 'A SQL command-line tool';
export const summary =
    'WASI has no JavaScript bindings: the program is a main() that links SQLite, built into one .wasm and run with wasmtime. This one runs SQL against a database file in the current directory and prints rows the way the sqlite3 shell does, so the file it writes opens in any SQLite tool.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/sqlite-tool-wasi-wasm32-st-release.wasm shop.db < shop.sql',
    'wasmtime run --dir=. .crossbind/build/sqlite-tool-wasi-wasm32-st-release.wasm shop.db "select customer, sum(qty * price) from orders group by customer order by 2 desc"',
];
export const expected = [
    'sqlite 3.53.4, shop.db: 3 statements, 4 rows changed',
    'linus|15.0',
    'ada|13.75',
    'sqlite 3.53.4, shop.db: 1 statement, 0 rows changed',
];

// The script the second command reads: the orders of the JSON usage example, as a table.
export function input() {
    return {
        'shop.sql': [
            'drop table if exists orders;',
            'create table orders(id integer primary key, customer text not null, sku text not null, qty integer not null, price real not null);',
            "insert into orders(customer, sku, qty, price) values ('ada', 'pen', 2, 1.5), ('ada', 'ink', 1, 4.0), ('linus', 'pen', 10, 1.5), ('ada', 'pad', 3, 2.25);",
            '',
        ].join('\n'),
    };
}
