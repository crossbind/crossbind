// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// `next dev` under Turbopack and under webpack, each in a dist folder of its own. The first page compiles and links the
// debug wasm, so the timeouts are a dev server's.
const SERVERS = [
    ['turbopack', 'http://localhost:3110', 'pnpm run dev'],
    ['webpack', 'http://localhost:3111', 'pnpm run dev:webpack'],
];
const BROWSERS = [['chromium', 'Desktop Chrome'], ['firefox', 'Desktop Firefox'], ['webkit', 'Desktop Safari']];

module.exports = defineConfig({
    testDir: './e2e',
    timeout: 300 * 1000,
    expect: {
        timeout: 240000,
    },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        trace: 'on-first-retry',
    },
    projects: SERVERS.flatMap(([bundler, baseURL]) => BROWSERS.map(([browser, device]) => ({
        name: `${bundler}-${browser}`,
        use: { ...devices[device], baseURL },
    }))),
    webServer: SERVERS.map(([, url, command]) => ({ command, url, timeout: 300 * 1000, reuseExistingServer: !process.env.CI })),
});
