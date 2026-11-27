import crossbind from 'crossbind';

/** @type {import('next').NextConfig} */
const nextConfig = {
    // The webpack build goes beside Turbopack's, so the tests serve both at once.
    distDir: process.env.NEXT_DIST_DIR ?? '.next',
    // `next dev` would write an AGENTS.md into the fixture.
    agentRules: false,
};

export default crossbind(nextConfig);
