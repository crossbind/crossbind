import { CATEGORY_LABELS, PORTS, publishedLibraryTargets } from '../ports/catalog.js';

// The SQLite panel queries this site's own library catalog: the rows below are the same generated
// data the Libraries pages read, handed to the database as plain SQL. Keeping the seed here rather
// than inside the C++ keeps the demo's native side a generic SQLite wrapper, and keeps the table
// honest - it cannot drift from the catalog the rest of the site shows.

export const TABLE = 'libraries';

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

export const createStatement = () => `create table ${TABLE} (name text, version text, category text, license text, targets integer);`;

export function insertStatement(ports = PORTS) {
    const rows = ports.map((port) => [
        quote(port.name),
        quote(port.nativeVersion),
        quote(CATEGORY_LABELS[port.category] ?? port.category),
        quote(port.license),
        String(publishedLibraryTargets(port).length),
    ]);
    return `insert into ${TABLE} values ${rows.map((row) => `(${row.join(', ')})`).join(', ')};`;
}

export const DEFAULT_QUERY = `select category, count(*) as libraries, group_concat(name, ', ') as names
from ${TABLE}
group by category
order by libraries desc, category;`;

// SQLite hands back one JSON array; the panel needs columns in the order the query asked for them.
export function toTable(json) {
    const rows = JSON.parse(json);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return {
        columns,
        rows: rows.map((row) => columns.map((column) => (row[column] === null ? '' : String(row[column])))),
    };
}
