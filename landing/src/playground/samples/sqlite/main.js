import { initNative, Database } from './native/database.h';
import { catalogAsSql } from './catalog.js';

await initNative();
const db = await new Database();
await db.exec(catalogAsSql);

const rows = await db.query(`
select category, count(*) as libraries,
       group_concat(name, ', ') as names
from libraries
group by category
order by libraries desc, category;
`);

for (const { category, libraries, names } of JSON.parse(rows)) {
    console.log(`${category}: ${libraries} (${names})`);
}
