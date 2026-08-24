import { defineConfig } from 'vitest/config';

export default defineConfig({
    // loadJs/loadConfig dynamically import config files written to os.tmpdir()
    // during tests. Vite 6 tightened server.fs.allow and rejects those out-of-root
    // paths ("Does the file exist?"); relax the fs check for the test runner.
    server: {
        fs: {
            strict: false,
        },
    },
    test: {
        include: ['test/**/*.test.js'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            // src/actions/ used to be excluded on the grounds that it only shells out to
            // docker/emcc/cargo, so a test there would pin a command line rather than behaviour,
            // and that the e2e suites already covered it. 2.0.0-beta.50 disproved the second half:
            // one call site asked docker for an image ref that does not exist on arm64, no e2e
            // exercised a machine without that image already cached, and android builds shipped
            // broken to every Apple Silicon user. Which command line these actions build IS the
            // behaviour, so the layer is measured.
            include: ['src/utils/**/*.js', 'src/state/**/*.js', 'src/assets/**/*.js', 'src/actions/**/*.js'],
            all: true,
            // A floor with a one-point band, not a ratchet. Coverage is not identical across
            // environments - resolveEmbindRust walks the real node_modules layout, so which of its
            // catch branches run differs between a dev machine and a fresh CI install - and the
            // totals land a few hundredths apart. Auto-raising these locally while enforcing them
            // exactly on CI therefore fails on that difference rather than on a regression: CI
            // measured 81.67/76.66/84.31/82.72 against floors written from a local run. The
            // figures below are a local run of the widened surface (62.18/55.64/65.96/62.09) minus
            // about a point. They read lower than the numbers they replace because they now count
            // src/actions/, not because anything regressed - the old floors simply were not
            // measuring the layer that broke. Raise them deliberately when a gain is worth
            // locking in.
            thresholds: {
                statements: 61.2,
                branches: 54.6,
                functions: 65.0,
                lines: 61.1,
            },
        },
    },
});
