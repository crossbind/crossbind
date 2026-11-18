import { initNative, Database } from './native/database.h';

await initNative();

const db = await new Database();
await db.run('create table t (x)');

const added = await db.run('insert into t values (1), (2)');
console.log('rows added:', added);
await db.delete();
