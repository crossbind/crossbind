// @ts-check
const { test, expect } = require('@playwright/test');

test('check string receiving from c++', async ({ page }) => {
    await page.goto('/')
    // The playground native's sample() returns "hello".
    await expect(page.getByText('Matrix multiplier with c++ => hello')).toBeVisible()
});

test('check rust class through the package import', async ({ page }) => {
    await page.goto('/')
    // RustyCounter comes from `import { RustyCounter } from '@crossbind/embind-rust-demo'`:
    // new(10)+increment(5)+increment(27) => 42; scale(2.5) => 105; fromText(' 42 ').label('n=')
    // => n=42 (&str param); fromText('nope') rejects (Result); parseOpt('nope') => null (Option);
    // Gauge toString (Display), addBig/maxU64 (BigInt i64/u64), doubleIt/greet (free functions),
    // the DIRECT `import { Uuid } from 'uuid'` crate import (v4 format + parse rejection),
    // geo's ConvexHull through the app-local surface, and Option returns (Some -> value,
    // None -> undefined: half/ratio(0)/maybeLabel/parseEven).
    // ...plus Option params, the &RustyCounter class param, and the semver/regex crate imports
    // (VersionReq.matches(Version) across classes; Regex throwing ctor + isMatch).
    await expect(page.locator('#rust')).toHaveText(
        'rust current=42 scale=105 label=n=42 err=true none=true gstr=gauge(40) big=true u64=true free=42:hello web uuid=true uuidErr=true hull=true opt=true'
        + ' optP=true ref=true sv=true re=true',
        { timeout: 15000 },
    )
});

test('conformance: every documented C++/Rust feature on this leg', async ({ page }) => {
    await page.goto('/')
    // pass == run from the shared @crossbind/conformance list, with no NO line appended. The
    // live-JS section is a documented SKIP on this worker-backed leg, hence the suffix.
    await expect(page.locator('#conf')).toHaveText(/^CONFORMANCE (\d+)\/\1( \([a-z]+: \d+(, [a-z]+: \d+)*\))?$/, { timeout: 20000 })
});

