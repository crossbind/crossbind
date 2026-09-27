export const title = 'Save a database to bytes and open it again';
export const summary =
    '`sqlite3_serialize` copies a database out as the bytes of its file, and `sqlite3_deserialize` opens such bytes as a database: the way to download, upload or cache a whole database. The copy is then listed with `sqlite_schema` and `pragma_table_info`.';
export const native = 'snapshot.h';
export const expected = ['8192 B, starts with "SQLite format 3"', 'readings(sensor TEXT, celsius REAL): 3 rows'];

export default async function example({ Snapshot }, console) {
    const db = await new Snapshot();
    await db.exec("create table readings(sensor text, celsius real); insert into readings values ('attic', 21.5), ('cellar', 12.25), ('garden', 17.0)");
    const image = await db.save();
    console.log(`${image.length} B, starts with "${image.slice(0, 15)}"`);

    const copy = await new Snapshot();
    await copy.load(image);
    console.log(await copy.describe());
}
