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

test('curl transfers go through fetch in the worker', async ({ page }) => {
    const { startCurlProbeServer, expectedCurlReport } = await import('../../config/curl-probe-server.mjs');
    const server = await startCurlProbeServer();
    try {
        await page.goto('/')
        const report = await page.evaluate(async ([url, deadUrl]) => {
            const { CurlProbe } = await globalThis.initNative({ path: './dist' });
            return CurlProbe.run(url, deadUrl);
        }, [server.url, server.deadUrl]);
        // The browser runtime defaults to useWorker, where curl blocks on a synchronous request.
        expect(report).toBe(expectedCurlReport({ blocking: true }))
    } finally {
        await server.close();
    }
});

// What GDAL reads in the worker from `source(server)`, a dataset name and its configuration options.
async function readRemote(page, source) {
    const probe = await import('../../config/curl-probe-server.mjs');
    const server = await probe.startCurlProbeServer();
    try {
        await page.goto('/')
        const read = await page.evaluate(async ([name, options]) => {
            const { RemoteRaster } = await globalThis.initNative({ path: './dist' });
            return RemoteRaster.read(name, options);
        }, source(server, probe));
        return { read, server, raster: probe.remoteRaster };
    } finally {
        await server.close();
    }
}

test('GDAL reads a remote raster through /vsicurl/ in the worker', async ({ page }) => {
    const { read, server, raster } = await readRemote(page, ({ url }) => [`/vsicurl/${url}/raster.tif`, '']);
    expect(read).toBe(`${raster.side}x${raster.side} sum=${raster.sum}`)
    // GDAL asked for parts of the file, not for the whole of it.
    expect(server.rasterRanges()).toBeGreaterThan(1)
});

test('GDAL reads a raster from a signed /vsis3/ bucket in the worker', async ({ page }) => {
    const { read, server, raster } = await readRemote(page, ({ url }, { remoteBucket }) => ['/vsis3/bucket/raster.tif', remoteBucket(url)]);
    expect(read).toBe(`${raster.side}x${raster.side} sum=${raster.sum}`)
    expect(server.signedReads()).toBeGreaterThan(1)
});

test('GDAL reads the tiles of a WMS server in the worker', async ({ page }) => {
    const { read, server, raster } = await readRemote(page, ({ url }, { remoteWms }) => [remoteWms(url), '']);
    expect(read).toBe(`${raster.side * 2}x${raster.side} sum=${raster.sum * 2}`)
    expect(server.wmsTiles()).toBe(2)
});
