// @ts-check
const { test, expect } = require('@playwright/test');

test('a conan: import binds zlib built from ConanCenter', async ({ page }) => {
    await page.goto('/');
    // compressBound(1000) is 1000 + 13 by zlib's own formula.
    await expect(page.locator('#zlib')).toHaveText('1.3.2 1013', { timeout: 20000 });
});

test('a package that requires another links it, and binds through its own header', async ({ page }) => {
    await page.goto('/');
    // libpng 1.6.58 reports itself as 10658.
    await expect(page.locator('#png')).toHaveText('10658', { timeout: 20000 });
});

test('an app header reaches a C and a C++ package, exceptions included', async ({ page }) => {
    await page.goto('/');
    // crc32('crossbind') as Python's zlib.crc32 reports it; the last value is an fmt::format_error
    // thrown in the Conan-built libfmt and caught by the app's code.
    await expect(page.locator('#app')).toHaveText('1142999569 3.14 format_error: invalid format specifier', { timeout: 20000 });
});
