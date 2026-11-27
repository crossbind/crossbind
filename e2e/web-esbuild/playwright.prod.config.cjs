// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// The page esbuild builds and the one Bun builds, each served with the isolation headers a multithreaded page needs.
const BUILDS = [
    ['esbuild', 'http://localhost:3100', 'pnpm run preview'],
    ['bun', 'http://localhost:3101', 'pnpm run preview:bun'],
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
