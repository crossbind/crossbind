export const title = 'Query JSON documents with SQL';
export const summary =
    'Keep JSON as it arrives and ask questions in SQL: `->>` reads a field, `json_each` turns an array into rows, and `json_group_object` and `json_group_array` build JSON answers.';
export const native = 'order_log.h';
export const expected = ['{"ada":13.75,"linus":15.0}', '{"pen":12,"pad":3,"ink":1}', '["ada","linus"]'];

export default async function example({ OrderLog }, console) {
    const orders = await new OrderLog();
    await orders.add('{"customer":"ada","items":[{"sku":"pen","qty":2,"price":1.5},{"sku":"ink","qty":1,"price":4}]}');
    await orders.add('{"customer":"linus","items":[{"sku":"pen","qty":10,"price":1.5}]}');
    await orders.add('{"customer":"ada","items":[{"sku":"pad","qty":3,"price":2.25}]}');
    console.log(await orders.totals());
    console.log(await orders.unitsSold());
    console.log(await orders.buyersOf('pen'));
}
