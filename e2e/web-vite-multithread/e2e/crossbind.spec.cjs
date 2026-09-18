// @ts-check
const { test, expect } = require('@playwright/test');

test('boots the module in a worker and runs a std::thread', async ({ page }) => {
    // Playwright's WebKit ships a broken OPFS backend (getDirectory rejects with
    // UnknownError); the runtime's preflight falls back to /memfs there, so this
    // spec runs on all three engines.
    await page.goto('/')
    await expect(page.getByText('ready (worker + pthreads)')).toBeVisible()
    await expect(page.getByText('hello from thread')).toBeVisible()
    // Instance methods + plain-array vector coercion through the worker:
    // statics cannot catch `this`-identity regressions, this line can.
    await expect(page.getByText('count:42 a+b')).toBeVisible()
    // `new` through the worker proxy (Comlink CONSTRUCT + embind prototype
    // identity): factories cannot catch construct regressions, this line can.
    await expect(page.getByText('ctor:21')).toBeVisible()
});

test('conformance: every documented C++/Rust feature on this leg', async ({ page }) => {
    await page.goto('/')
    // pass === run (backreference), optionally with a skipped tail; NO lines break the match.
    await expect(page.locator('#conf')).toHaveText(/^CONFORMANCE (\d+)\/\1( \([a-z]+: \d+(, [a-z]+: \d+)*\))?$/, { timeout: 20000 })
});
