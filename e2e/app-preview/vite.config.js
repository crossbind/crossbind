import { defineConfig } from 'vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

// A plugin before crossbind's, as a project's own mock of an API would be, whose middleware answers a path of its own.
function earlyAnswer() {
    return {
        name: 'e2e-early-answer',
        enforce: 'pre',
        configureServer(server) {
            server.middlewares.use('/__e2e/early', (req, res) => res.end('early'));
        },
    };
}

// The extension's page module comes from the workspace, which Vite serves as a source of its own unless asked to
// optimize it, as it does a package of node_modules.
export default defineConfig({
    plugins: [earlyAnswer(), viteCrossbindPlugin()],
    optimizeDeps: { include: ['@crossbind/extension-clipboard'] },
});
