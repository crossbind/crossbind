// @ts-check
const { test, expect } = require('@playwright/test');

test('check string receiving from c++', async ({ page }) => {
    await page.goto('/')
    // The playground worker responds with `- ${Native.sample()} - | CONFORMANCE ...`.
    await expect(page.getByText('- hello -')).toBeVisible()
});

test('conformance: every documented C++/Rust feature on this leg', async ({ page }) => {
    await page.goto('/')
    // pass === run (backreference), optionally with a skipped tail; NO lines add detail
    // rows after the summary and break the match.
    await expect(page.locator('body')).toHaveText(/\| CONFORMANCE (\d+)\/\1( \([a-z]+: \d+(, [a-z]+: \d+)*\))?$/, { timeout: 20000 })
});
