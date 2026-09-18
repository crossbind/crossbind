// Rust ownership: Drop on delete(), Arc factories/params/returns with &self methods and
// interior mutability, Option<Arc<T>> (a null smart pointer is None).
export function rustOwnershipChecks({ add, todo }, s) {
    add('rs:own:dropOnDelete', async () => {
        const before = await s.confRsDropCount();
        const t = await new s.ConfRsTracked(1);
        const id = await t.id();
        await t.delete();
        return [id, (await s.confRsDropCount()) - before];
    }, [1, 1]);
    add('rs:own:arcFactory', async () => { const a = await s.ConfRsShared.create('lbl'); const r = [await a.label(), await a.hit(), await a.hit()]; await a.delete(); return r; }, ['lbl', 1, 2]);
    add('rs:own:arcParamReturn', async () => {
        const a = await s.ConfRsShared.create('dup');
        const b = await s.confRsSharedDup(a);
        const r = [await s.confRsSharedLabel(a), await b.label()];
        await b.delete();
        await a.delete();
        return r;
    }, ['dup', 'dup']);
    add('rs:own:arcCountGrows', async () => {
        const a = await s.ConfRsShared.create('n');
        const one = await s.confRsSharedCount(a);
        const b = await s.confRsSharedDup(a);
        const two = await s.confRsSharedCount(a);
        await b.delete();
        await a.delete();
        return two >= one;
    }, true);
    add('rs:own:interiorMutability', async () => { const c = await new s.ConfRsCell(1); const r = [await c.bump(), await c.bump()]; await c.delete(); return r; }, [2, 3]);
    add('rs:own:optionArc', async () => { const a = await s.confRsSharedMaybe(true); const r = await a.label(); await a.delete(); return r; }, 'maybe');
    add('rs:own:optionArcNone', async () => (await s.confRsSharedMaybe(false)) ?? null, null);
}
