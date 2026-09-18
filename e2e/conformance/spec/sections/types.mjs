// Enums, virtual bases, name collisions, cross-header bindings, export macros, ignored and
// prelude-dependent declarations (native/conftypes.h, conftypes2.h, confkinda.h, confkindb.h, confprelude.h).
export function typeChecks({ add }, t, { worker }) {
    add('type:plainEnum', async () => t.confTypeColor(await t.ConfColor.CONF_GREEN), 20);
    add('type:scopedEnum', async () => t.confTypeMode(await t.ConfMode.Safe), 400);
    add('type:enumReturn', async () => (await t.confTypeSafer(await t.ConfMode.Fast)) === (await t.ConfMode.Safe), true);
    add('type:abstractBaseExported', () => typeof t.ConfTypeShape, 'function');
    add('type:virtualBaseDowncast', async () => {
        const quad = await t.confTypeMakeQuad();
        return [worker || quad instanceof t.ConfTypeQuad, await quad.corners(), await t.confTypeSides(quad)];
    }, [true, 4, 4]);
    add('type:enumNameCollision', async () => [await t.ConfWktFormatter.use(await t.Convention.WKT2), await t.ConfProjFormatter.use(await t.ConfProjFormatter_Convention.PROJ5)], [2, 5]);
    add('type:exportMacroForwarded', () => t.confTypeMarked(), 42);
    add('type:declaredOnlyIgnored', async () => typeof (await t.confTypeDeclaredOnly), 'undefined');
    add('type:crossHeaderInstance', async () => t.confType2Corners(await t.confTypeMakeQuad()), 40);
    add('type:crossHeaderEnum', async () => (await t.confType2Flip(await t.ConfMode.Safe)) === (await t.ConfMode.Fast), true);
    add('type:duplicateDeclarationOnce', async () => t.confTypeSides(await t.confTypeMakeQuad()), 4);
    add('type:sameEnumNameTwice', async () => [await t.confKindA(await t.ConfKind.Dashed), await t.confKindB(await t.ConfKind.Dashed)], [20, 200]);
    add('type:headerPrelude', async () => [await t.confPreludeTwice(5), await t.confPreludeBase()], [110, 100]);
}
