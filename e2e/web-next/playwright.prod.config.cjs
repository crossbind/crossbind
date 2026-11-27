// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// `next start` on Turbopack's build and on webpack's, which go to separate dist folders. Next's dev server answers its
// own host alone, so the tests ask localhost.
const BUILDS = [
    ['turbopack', 'http://localhost:3110', 'pnpm run start'],
    ['webpack', 'http://localhost:3111', 'pnpm run start:webpack'],
];
const BROWSERS = [['chromium', 'Desktop Chrome'], ['firefox', 'Desktop Firefox'], ['webkit', 'Desktop Safari']];

module.exports = defineConfig({
    testDir: './e2e',
    timeout: 30 * 1000,
    expect: {
        timeout: 50000,
    },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        trace: 'on-first-retry',
    },
    projects: BUILDS.flatMap(([build, baseURL]) => BROWSERS.map(([browser, device]) => ({
        name: `${build}-${browser}`,
        use: { ...devices[device], baseURL },
    }))),
    webServer: BUILDS.map(([, url, command]) => ({ command, url, reuseExistingServer: !process.env.CI })),
});
