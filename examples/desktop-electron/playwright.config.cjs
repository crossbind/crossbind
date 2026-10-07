const { defineConfig } = require('@playwright/test');

// dev runs the app from its sources, packaged runs what `electron-builder --dir` wrote to out/.
module.exports = defineConfig({
    testDir: './e2e',
    timeout: 60 * 1000,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'list',
    projects: [
        { name: 'dev', use: { packaged: false } },
        { name: 'packaged', use: { packaged: true } },
    ],
});
