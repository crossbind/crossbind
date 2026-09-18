import { rejecting } from '../expect.mjs';

// Rust enums, value objects, classes, traits and serde: #[repr(i32)] unit enums, repr(C) Copy
// structs with primitive fields, classes with new/factories/methods (max 6 args each), Display,
// serde_json::Value. Data enums, nested value objects, plain pub fields, consuming self,
// chaining, Self returns, wider arities, trait objects, generics and serde derives are todo.
export function rustTypeChecks({ add, todo, skip }, s) {
    const rejects = rejecting(add);
    add('rs:enum:value', async () => s.confRsColorCode(await s.ConfRsColor.Green), 2);
    add('rs:enum:discriminant', async () => s.confRsColorCode(await s.ConfRsColor.Blue), 4);
    add('rs:enum:return', async () => s.confRsColorCode(await s.confRsColorFrom(1)), 1);
    todo('rs:enum:optionReturn', async () => s.confRsColorCode(await s.confRsColorOpt(true)), 4);
    add('rs:enum:reprU8', async () => (await s.confRsSmallFlip(await s.ConfRsSmall.Low)) === (await s.ConfRsSmall.High), true);
    add('rs:enum:dataVariants', () => s.confRsKindArea({ Circle: 2 }), 12);
    add('rs:struct:valueObjectOut', async () => { const p = await s.confRsPointMake(3, 0.5); return [await p.x, await p.y]; }, [3, 0.5]);
    add('rs:struct:valueObjectIn', () => s.confRsPointSum({ x: 1, y: 2.5 }), 3.5);
    add('rs:struct:nestedValueObject', () => s.confRsSegmentLen({ a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }), 7);
    add('rs:struct:plainFields', async () => { const p = await s.confRsPlainMake('n', 3); return [await p.name, await p.count]; }, ['n', 3]);
    add('rs:class:ctorMethods', async () => {
        const b = await new s.ConfRsBox(5);
        const r = [await b.value(), await b.add(2), await b.many(1, 2, 3, 4), await b.tag('t')];
        await b.delete();
        return r;
    }, [5, 7, 17, 1]);
    add('rs:class:resultFactory', async () => { const b = await s.ConfRsBox.fromText(' 12 '); const v = await b.value(); await b.delete(); return v; }, 12);
    rejects('rs:class:resultFactoryThrows', () => s.ConfRsBox.fromText('x'), /invalid digit/);
    add('rs:class:optionFactoryNull', () => s.ConfRsBox.maybe(-1), null);
    add('rs:class:display', async () => { const b = await new s.ConfRsBox(3); const r = await b.toString(); await b.delete(); return r; }, 'ConfRsBox(3)');
    add('rs:class:valueObjectRoundTrip', async () => {
        const b = await new s.ConfRsBox(2);
        const p = await b.point();
        const y = await b.setPoint({ x: 9, y: 1.5 });
        const r = [await p.x, y, await b.value()];
        await b.delete();
        return r;
    }, [2, 1.5, 9]);
    add('rs:class:enumReturn', async () => { const b = await new s.ConfRsBox(1); const c = await s.confRsColorCode(await b.color()); await b.delete(); return c; }, 2);
    add('rs:class:classRefParam', async () => {
        const a = await new s.ConfRsBox(1);
        const b = await new s.ConfRsBox(2);
        const r = await a.otherValue(b);
        await a.delete();
        await b.delete();
        return r;
    }, 3);
    add('rs:class:jsonMethod', async () => { const b = await new s.ConfRsBox(4); const r = await b.json({ k: [1] }); await b.delete(); return r; }, { input: { k: [1] }, value: 4 });
    add('rs:class:fiveArgs', async () => { const b = await new s.ConfRsBox(0); const r = await b.tooMany(1, 2, 3, 4, 5); await b.delete(); return r; }, 15);
    // Not carried, and napi-rs does not carry it either: JS holds the instance, so Rust cannot
    // take ownership out of it mid-call. Write `&self` and return what you need instead.
    skip('rs:class:consumingSelf', 'a method cannot consume self while JS owns the instance');
    add('rs:class:selfReturn', async () => { const b = await new s.ConfRsBox(6); const t = await b.twin(); const r = await t.value(); await t.delete(); await b.delete(); return r; }, 6);
    add('rs:class:chaining', async () => { const b = await new s.ConfRsBox(1); const r = await (await b.chain(2)).value(); await b.delete(); return r; }, 3);
    add('rs:class:fourArgCtor', async () => { const w = await new s.ConfRsWide(1, 2, 3, 4); const r = await w.total(); await w.delete(); return r; }, 10);
    add('rs:class:defaultCtor', async () => { const d = await new s.ConfRsDefaulted(); const r = await d.n(); await d.delete(); return r; }, 0);
    add('rs:class:strRefReturn', async () => { const b = await new s.ConfRsBox(1); const r = await b.labelRef(); await b.delete(); return r; }, 'ref');
    add('rs:trait:usedInternally', async () => { const c = await new s.ConfRsCircle(2); const r = [await c.areaViaTrait(), await c.nameViaDefault()]; await c.delete(); return r; }, [12, 'shape']);
    // Not carried: a trait object has no concrete type to register, and JS has no place to put
    // one. Take the concrete class (or an enum of the shapes you support) instead.
    skip('rs:trait:dynParam', 'a trait object is not a registrable type');
    skip('rs:trait:boxedReturn', 'a trait object is not a registrable type');
    // Not carried: nothing says which instantiations to bind, so the binding would be a guess.
    skip('rs:trait:generic', 'a generic function has no instantiation to bind');
    add('rs:trait:implIterator', async () => Array.from(await s.confRsImplIter(3)), [0, 1, 2]);
    add('rs:serde:jsonValue', () => s.confRsRecordJson({ id: 1, name: 'n' }), { id: 2, name: 'n' });
    add('rs:serde:deriveStruct', () => s.confRsRecordEcho({ id: 1, name: 'n' }), { id: 2, name: 'n' });
}
