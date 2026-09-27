export const title = 'Apply a batch in one transaction';
export const summary =
    '`BEGIN`, one prepared upsert (`ON CONFLICT DO UPDATE`) reset and re-bound for every row, then `COMMIT`. A row that breaks a `CHECK` constraint makes the wrapper `ROLLBACK`, which undoes the rows before it as well.';
export const native = 'ledger.h';
export const expected = [
    '10000 rows applied',
    'alice 13333, bob 13330, carol 13331',
    'rolled back: CHECK constraint failed: total >= 0',
    'alice 13333, bob 13330, carol 13331',
];

export default async function example({ Ledger }, console) {
    const ledger = await new Ledger();
    const accounts = ['alice', 'bob', 'carol'];
    const rows = Array.from({ length: 10000 }, (_, i) => `${accounts[i % 3]},${(i % 7) + 1}`);
    console.log(await ledger.apply(rows.join('\n')), 'rows applied');
    console.log(await ledger.balances());
    try {
        await ledger.apply('alice,5\nbob,-1000000');
    } catch (error) {
        // wasm builds add the C++ type in front of the message and keep the text in cppMessage.
        console.log('rolled back:', error.cppMessage ?? error.message);
    }
    console.log(await ledger.balances());
}
