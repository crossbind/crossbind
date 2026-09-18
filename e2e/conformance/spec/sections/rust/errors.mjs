import { rejecting } from '../expect.mjs';

// Rust errors: Result<T, E: Display> throws a JS Error carrying Display; () and String Ok
// values, boxed errors, Result<Option<T>>.
export function rustErrorChecks({ add, todo }, s) {
    const rejects = rejecting(add);
    add('rs:err:customOk', () => s.confRsErrCustom(false), 1);
    rejects('rs:err:customMessage', () => s.confRsErrCustom(true), /conf error 7/);
    add('rs:err:errorInstance', async () => { try { await s.confRsErrString(true); return false; } catch (e) { return e instanceof Error; } }, true);
    add('rs:err:stringOk', () => s.confRsErrString(false), 'text ok');
    rejects('rs:err:stringErr', () => s.confRsErrString(true), /text failed/);
    add('rs:err:unitOk', async () => (await s.confRsErrUnit(false)) ?? null, null);
    rejects('rs:err:unitErr', () => s.confRsErrUnit(true), /unit failed/);
    add('rs:err:boxedOk', () => s.confRsErrBoxed(false), 2);
    add('rs:err:boxedErr', async () => { try { await s.confRsErrBoxed(true); return 'no-throw'; } catch (e) { return /conf error 9/.test(String(e?.message ?? e)); } }, true);
    add('rs:err:optionOk', () => s.confRsErrOption(false), 3);
    add('rs:err:valueObjectOk', async () => { const p = await s.confRsErrPoint(false); return [await p.x, await p.y]; }, [1, 1.5]);
}
