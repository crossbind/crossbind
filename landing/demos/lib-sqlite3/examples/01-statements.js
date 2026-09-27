export const title = 'Insert and query with prepared statements';
export const summary =
    "The calls behind most SQLite code: `sqlite3_prepare_v2`, `sqlite3_bind_text`, `sqlite3_step` and `sqlite3_column_*`. Values go in as bound parameters, so the apostrophe in \"parser's\" is data, not SQL.";
export const native = 'notes.h';
export const expected = ['3.53.4 3', "2: write the README\n3: fix the parser's bug"];

export default async function example({ Notes }, console) {
    const notes = await new Notes();
    for (const body of ['buy milk', 'write the README', "fix the parser's bug"]) await notes.add(body);
    console.log(await Notes.version(), await notes.count());
    console.log(await notes.find('the'));
}
