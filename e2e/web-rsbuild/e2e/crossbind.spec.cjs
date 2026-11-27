// @ts-check
const { test, expect } = require('@playwright/test');

test('check string receiving from c++', async ({ page }) => {
    // Runs on all three engines: the runtime's OPFS preflight sidesteps
    // Playwright WebKit's broken storage backend (see fs-browser.js).
    await page.goto('/')
    await expect(page.getByText('ready (pthreads)')).toBeVisible()
    // The real mt signal: a std::thread ran and reported back.
    await expect(page.getByText('hello from thread')).toBeVisible()
});

test('conformance: every documented C++/Rust feature on this leg', async ({ page }) => {
    await page.goto('/')
    // pass === run (backreference), optionally with a skipped tail; NO lines break the match.
    await expect(page.locator('#conf')).toHaveText(/^CONFORMANCE (\d+)\/\1( \([a-z]+: \d+(, [a-z]+: \d+)*\))?$/, { timeout: 20000 })
});
