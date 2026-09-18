// Cross-runtime conformance: every documented C++ and Rust binding feature as one
// data-driven list. Each leg (node / browser / React Native) wires the surfaces its runtime
// model actually has; everything else becomes an explicit SKIP line - never a silent gap.
//
// Every binding call is awaited on purpose: on worker-backed runtimes each call (including
// `new` and field reads) resolves through the proxy, and on synchronous runtimes the awaits
// are plain passthroughs - so one list serves both models.
//
// Surfaces:
//   cpp:          { ConfBox, ConfCircle, ConfOps }            (any leg - import the .h)
//   rustPkg:      { RustyCounter, Widget, Gauge, Mode, RustIntVector, doubleIt, greet,
//                   checkedParse, parseEven, tag, jsonEcho, jsonTally, jsonPick,
//                   SharedDoc, dupDoc, sharedDropCount }      (any leg - prebuilt package)
//   rustAppLocal: { Counter, Hull }                           (bundler legs only)
//   rustCrates:   { Uuid, Version, VersionReq, Regex }        (bundler legs only)
//   jsLive:       { jsPass, jsProbe, jsCall, jsStore, jsFire } (synchronous runtimes only -
//                   on worker-backed legs functions cannot cross and identity dies)
//   pointers, callbacks, strings, wrappers, types: the module namespace of the matching kit
//                   header (any leg; the checks that pass JS functions skip on worker legs)
//   rustKit:      the exports of @crossbind/conformance-rust (any leg - prebuilt package);
//                   constructs the generator does not carry yet are `todo` entries, reported
//                   as TODO lines and counted apart from the pass/run figures
//   coverage:     { exports, seen } from spec/bridgeExports.mjs + spec/coverage.mjs (legs that build the bridges)

import { callbackChecks } from './sections/callbacks.mjs';
import { pointerChecks } from './sections/pointers.mjs';
import { stringChecks } from './sections/strings.mjs';
import { typeChecks } from './sections/types.mjs';
import { wrapperChecks } from './sections/wrappers.mjs';
import { untouchedExports } from './coverage.mjs';
import { rustCollectionChecks } from './sections/rust/collections.mjs';
import { rustErrorChecks } from './sections/rust/errors.mjs';
import { rustNumberChecks } from './sections/rust/numbers.mjs';
import { rustOwnershipChecks } from './sections/rust/ownership.mjs';
import { rustParityChecks } from './sections/rust/parity.mjs';
import { rustStringChecks } from './sections/rust/strings.mjs';
import { rustSurfaceChecks } from './sections/rust/surface.mjs';
import { rustTypeChecks } from './sections/rust/types.mjs';

function section(list, name, why, fill) {
    if (!fill) {
        list.push({ name: `${name}:*`, skip: why });
        return;
    }
    fill();
}

export function buildChecks(s) {
    const list = [];
    const add = (name, run, expected) => list.push({ name, run, expected });
    const skip = (name, why) => list.push({ name, skip: why });
    // A todo runs like a check but a miss is reported as TODO, not NO: the construct is
    // wanted and not carried yet, so the leg's gate stays green until the generator learns it.
    const todo = (name, run, expected) => list.push({ name, run, expected, todo: true });
    // Worker-backed legs proxy every call; the remaining shape differences are contracts,
    // not gaps: vector returns arrive as plain arrays, plain arrays coerce into vector
    // params, and embind enum values cannot be structured-cloned.
    const worker = Boolean(s.caps?.worker);

    section(list, 'cpp', 'no C++ surface wired on this leg', s.cpp && (() => {
        const { ConfBox, ConfCircle, ConfOps } = s.cpp;
        // Public value fields ride the injected .property lines on every leg (the jsi fork
        // has _embind_register_class_property too); worker legs read and write them through
        // the comlink proxy, so every access is awaited.
        add('cpp:ctor+fields', async () => { const b = await new ConfBox(6, 4); return [await b.width, await b.height]; }, [6, 4]);
        add('cpp:fieldWrite', async () => {
            const b = await new ConfBox(6, 4);
            b.width = 9;
            return [await b.width, await b.area()];
        }, [9, 36]);
        if (worker) {
            // CONTRACT, not a gap: the worker boundary deliberately converts embind vectors
            // to plain arrays (embindVector transfer handler), so returns are arrays here.
            add('cpp:vectorOut', async () => { const d = await (await new ConfBox(6, 4)).dims(); return [d[0], d[1]]; }, [6, 4]);
            // The worker proxy coerces plain arrays into vector params; direct runtimes need
            // a real vector instance (see the else branch).
            add('cpp:vectorIntIn', async () => (await new ConfBox(6, 4)).sum([1, 2, 3]), 6);
            add('cpp:vectorStrIn', async () => (await new ConfBox(6, 4)).join(['x', 'y']), 'x,y');
        } else {
            // Direct legs (node, direct wasm, jsi): by-value returns are real vector
            // proxies; params take a vector instance built from another return.
            add('cpp:vectorOut', async () => { const d = await (await new ConfBox(6, 4)).dims(); return [await d.get(0), await d.get(1)]; }, [6, 4]);
            add('cpp:vectorIntIn', async () => { const b = await new ConfBox(1, 2); return b.sum(await (await new ConfBox(6, 4)).dims()); }, 10);
            add('cpp:vectorStrIn', async () => { const b = await new ConfBox(6, 4); return b.join(await b.letters()); }, 'x,y');
        }
        add('cpp:method', async () => (await new ConfBox(6, 4)).area(), 24);
        add('cpp:bool', async () => (await new ConfBox(6, 4)).wide(), true);
        add('cpp:double', async () => (await new ConfBox(6, 4)).scale(2.5), 60);
        add('cpp:string', async () => (await new ConfBox(6, 4)).tag('a='), 'a=24');
        add('cpp:stringEcho', () => ConfOps.echo('round trip'), 'round trip');
        add('cpp:sharedFactory', async () => (await ConfBox.square(5)).area(), 25);
        add('cpp:virtualDispatch', async () => (await ConfCircle.asShape()).describe(), 'I am circle');
        add('cpp:throw', async () => {
            try { await ConfOps.checkedSqrt(-1); return 'no-throw'; } catch (e) {
                return e !== undefined;
            }
        }, true);
        // wasm legs decode via getExceptionMessage (worker legs re-throw the decoded
        // Error); the jsi fork rethrows std::exception as JSError with the what() text.
        add('cpp:throwMessage', async () => {
            try { await ConfOps.checkedSqrt(-1); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('sqrt of negative');
            }
        }, true);
        add('cpp:noThrow', () => ConfOps.checkedSqrt(9), 3);
        add('cpp:optionalSome', () => ConfOps.half(42), 21);
        add('cpp:optionalNone', async () => (await ConfOps.half(7)) ?? 'empty', 'empty');
    }));

    section(list, 'rustPkg', 'no Rust package surface wired on this leg', s.rustPkg && (() => {
        const {
            RustyCounter, Widget, Gauge, Mode, RustIntVector,
            doubleIt, greet, checkedParse, parseEven, tag,
            jsonEcho, jsonTally, jsonPick, SharedDoc, dupDoc, sharedDropCount,
        } = s.rustPkg;
        add('rust:ctor+methods', async () => {
            const c = await new RustyCounter(10);
            await c.increment(5);
            const r = [await c.increment(27), await c.current(), await c.addSpan(2, 5)];
            await c.delete();
            return r;
        }, [42, 42, 45]);
        add('rust:bool', async () => { const c = await new RustyCounter(1); const r = await c.isPositive(); await c.delete(); return r; }, true);
        // Worker legs included: the embindEnum transfer handler gives enum values stable
        // token identity across the boundary, so `===` holds in both directions.
        add('rust:enum', async () => {
            const c = await new RustyCounter(1);
            const fast = await Mode.Fast;
            const r = (await c.setMode(fast)) === fast;
            await c.delete();
            return r;
        }, true);
        add('rust:valueObject', async () => {
            const c = await new RustyCounter(45);
            const p = await c.asPoint();
            const r = [p.x, p.y, await c.sumPoint({ x: 3, y: 4 })];
            await c.delete();
            return r;
        }, [45, 0, 7]);
        add('rust:double', async () => { const c = await new RustyCounter(45); const r = await c.scale(2.5); await c.delete(); return r; }, 112.5);
        add('rust:vector', async () => {
            const v = await new RustIntVector();
            await v.push_back(11);
            await v.push_back(22);
            const r = [await v.size(), await v.get(1)];
            await v.delete();
            return r;
        }, [2, 22]);
        add('rust:staticFactory', async () => { const w = await Widget.create(6); const r = await w.area(); await w.delete(); return r; }, 36);
        add('rust:strParam', async () => {
            const t = await RustyCounter.fromText(' 42 ');
            const r = await t.label('n=');
            await t.delete();
            return r;
        }, 'n=42');
        add('rust:resultThrow', async () => {
            try { await RustyCounter.fromText('nope'); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('invalid digit');
            }
        }, true);
        add('rust:optionNull', () => RustyCounter.parseOpt('nope'), null);
        add('rust:ctorThrow', async () => {
            try { const g = await new Gauge(101); await g.delete(); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('out of range');
            }
        }, true);
        add('rust:bigint', async () => {
            const b = await new RustyCounter(42);
            const r = (await b.addBig(1000000000000n)) === 1000000000042n && (await b.maxU64()) === 18446744073709551615n;
            await b.delete();
            return r;
        }, true);
        add('rust:display', async () => { const g = await new Gauge(40); const r = await g.toString(); await g.delete(); return r; }, 'gauge(40)');
        add('rust:freeFns', async () => [await doubleIt(21), await greet('conf')], [42, 'hello conf']);
        add('rust:freeThrow', async () => {
            try { await checkedParse('x'); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('invalid digit');
            }
        }, true);
        add('rust:optionalReturns', async () => {
            const b = await new RustyCounter(42);
            // None is null on every runtime (never undefined), like a C++ nullptr or empty optional.
            const r = [await b.half(), await b.ratio(2), await b.maybeLabel(), await b.ratio(0)];
            await b.delete();
            return [...r, await parseEven(' 8 '), (await parseEven('7')) ?? 'odd'];
        }, [21, 21, 'v42', null, 8, 'odd']);
        add('rust:optionalParams', async () => {
            const b = await new RustyCounter(10);
            const r = [await b.bump(5), await b.bump(undefined), await b.bump(null)];
            await b.delete();
            return [...r, await tag('x'), await tag(undefined)];
        }, [15, 16, 17, '[x]', '[none]']);
        add('rust:classRef', async () => {
            const a = await new RustyCounter(42);
            const b = await new RustyCounter(10);
            const r = await a.diff(b);
            await a.delete();
            await b.delete();
            return r;
        }, 32);
        add('rust:jsonRoundtrip', () => jsonEcho({ a: 1, list: [1, 2.5, 'x', null, true], nested: { k: 'v' } }), { a: 1, list: [1, 2.5, 'x', null, true], nested: { k: 'v' } });
        add('rust:jsonBuild', () => jsonTally({ items: [1, 2, 3] }), { hasItems: true, total: 6 });
        add('rust:jsonThrow', async () => {
            try { await jsonPick({}, 'zz'); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('missing key zz');
            }
        }, true);
        add('rust:arcShared', async () => {
            const base = await sharedDropCount();
            const d1 = await SharedDoc.create('conf');
            const d2 = await dupDoc(d1);
            const same = await d1.sameAs(d2);
            const label = await d2.label();
            await d1.delete();
            const half = (await sharedDropCount()) - base;
            await d2.delete();
            const full = (await sharedDropCount()) - base;
            return [same, label, half, full];
        }, [true, 'conf', 0, 1]);
    }));

    section(list, 'rustAppLocal', 'app-local .rs surfaces need a bundler (vite/webpack/metro) leg', s.rustAppLocal && (() => {
        const { Counter, Hull } = s.rustAppLocal;
        if (Counter) {
            add('rustLocal:class', async () => {
                const k = await new Counter(40);
                await k.add(2);
                const r = await k.total();
                await k.delete();
                return r;
            }, 42);
        }
        if (Hull) {
            // The two playground surfaces expose different Hull shapes; accept either.
            add('rustLocal:upstreamCrate', async () => {
                if (typeof Hull.fromWkt === 'function') {
                    const h = await Hull.fromWkt('MULTIPOINT((0 0),(4 0),(0 4),(4 4),(2 2))');
                    const ok = (await h.isValid()) && (await h.hullArea()) === 16 && (await h.hullWkt()).startsWith('POLYGON');
                    await h.delete();
                    return ok;
                }
                const h = await new Hull();
                await h.add(0, 0);
                await h.add(4, 0);
                await h.add(4, 4);
                await h.add(0, 4);
                await h.add(2, 2);
                const wkt = await h.wkt();
                await h.delete();
                return typeof wkt === 'string' && wkt.includes('POLYGON');
            }, true);
        }
    }));

    section(list, 'rustCrates', 'cargo: crate imports need a bundler (vite/webpack/metro) leg', s.rustCrates && (() => {
        const { Uuid, Version, VersionReq, Regex } = s.rustCrates;
        add('crate:uuid', async () => {
            const u = await Uuid.newV4();
            const t = await u.toString();
            await u.delete();
            return /^[0-9a-f-]{36}$/.test(t);
        }, true);
        add('crate:semver', async () => {
            const req = await VersionReq.parse('^1.2');
            const v = await Version.parse('1.4.0');
            const r = await req.matches(v);
            await req.delete();
            await v.delete();
            return r;
        }, true);
        add('crate:regex', async () => {
            const re = await new Regex('^c[a-z]+$');
            const r = await re.isMatch('conf');
            await re.delete();
            return r;
        }, true);
    }));

    section(list, 'jsLive', 'JsValue/JsFunction need a synchronous runtime (worker-backed legs cannot pass functions or keep identity)', s.jsLive && (() => {
        const { jsPass, jsProbe, jsCall, jsStore, jsFire } = s.jsLive;
        add('live:identity', () => { const o = { a: 1 }; return jsPass(o) === o; }, true);
        add('live:getSet', () => {
            const o = { a: 21 };
            const r = jsProbe(o);
            return [r === o, o.b, o.note];
        }, [true, 42, 'set-by-rust']);
        add('live:callback', () => jsCall((x) => ({ doubled: x * 2 }), 3.5), { doubled: 7 });
        add('live:callbackThrow', () => {
            try { jsCall(() => { throw new Error('cb boom'); }, 1); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('cb boom');
            }
        }, true);
        add('live:retainedCallback', () => { jsStore((x) => x + 100); return jsFire(7); }, 107);
    }));

    // Worker legs pass handles and instances back through the adapter's object registry; only JS
    // functions cannot cross, and identity/vector shapes differ as in the cpp section.
    section(list, 'pointers', 'no pointer surface wired on this leg', s.pointers && (() => pointerChecks({ add }, s.pointers, { worker })));
    section(list, 'callbacks', 'no callback surface wired on this leg', s.callbacks && (() => callbackChecks({ add, skip }, s.callbacks, { worker })));
    section(list, 'strings', 'no string surface wired on this leg', s.strings && (() => stringChecks({ add }, s.strings)));
    section(list, 'wrappers', 'no wrapper surface wired on this leg', s.wrappers && (() => wrapperChecks({ add }, s.wrappers, { worker })));
    section(list, 'types', 'no type surface wired on this leg', s.types && (() => typeChecks({ add }, s.types, { worker })));
    section(list, 'rustKit', 'no Rust kit surface wired on this leg', s.rustKit && (() => {
        rustNumberChecks({ add, todo, skip }, s.rustKit);
        rustStringChecks({ add, todo }, s.rustKit);
        rustCollectionChecks({ add, todo }, s.rustKit);
        rustTypeChecks({ add, todo, skip }, s.rustKit);
        rustErrorChecks({ add, todo }, s.rustKit);
        rustOwnershipChecks({ add, todo }, s.rustKit);
        rustSurfaceChecks({ add, todo, skip }, s.rustKit, { worker });
        rustParityChecks({ add, todo, skip }, s.rustKit, { worker, jsi: Boolean(s.caps?.jsiNative) });
    }));
    // Last on purpose: it reads what every earlier check touched.
    section(list, 'coverage', 'no export list wired on this leg', s.coverage && (() => add('coverage:everyExportTouched', () => untouchedExports(s.coverage.exports, s.coverage.seen), [])));
    return list;
}

const encode = (v) => JSON.stringify(v, (key, x) => (typeof x === 'bigint' ? `${x}n` : x));

// Checks like rust:arcShared read a process-wide counter and assert on its delta, so two
// runs overlapping in the same runtime read each other's drops. React StrictMode double-invokes
// effects in dev, which is exactly how that happens - serialize instead of interleaving, so a
// leg that starts the kit twice still measures one run at a time.
let inFlight = Promise.resolve();

export function runConformance(surfaces) {
    const result = inFlight.then(() => runChecks(surfaces));
    inFlight = result.catch(() => {});
    return result;
}

async function runChecks(surfaces) {
    const lines = [];
    let pass = 0;
    let run = 0;
    let skipped = 0;
    let todos = 0;
    for (const check of buildChecks(surfaces)) {
        if (check.skip) {
            skipped += 1;
            lines.push(`SKIP ${check.name} (${check.skip})`);
            continue;
        }
        let got;
        let error;
        try {
            got = await check.run();
        } catch (e) {
            error = e?.message ?? e;
        }
        const ok = error === undefined && (check.expected === undefined || encode(got) === encode(check.expected));
        const detail = error === undefined ? `${check.name}=${encode(got)}` : `${check.name} ERR:${error}`;
        if (check.todo && !ok) {
            todos += 1;
            lines.push(`TODO ${detail}`);
            continue;
        }
        run += 1;
        if (ok) pass += 1;
        // A todo that passes is ready to become a plain check.
        lines.push(`${ok ? 'OK' : 'NO'} ${detail}${check.todo ? ' (todo passes: promote it)' : ''}`);
    }
    const counts = [skipped ? `skipped: ${skipped}` : '', todos ? `todo: ${todos}` : ''].filter(Boolean);
    const summary = `CONFORMANCE ${pass}/${run}${counts.length ? ` (${counts.join(', ')})` : ''}`;
    return { pass, run, skipped, todos, summary, lines };
}
