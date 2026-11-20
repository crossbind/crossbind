import { defineConfig } from 'vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

// The extension's page module comes from the workspace, which Vite serves as a source of its own unless asked to
// optimize it, as it does a package of node_modules.
export default defineConfig({
    plugins: [viteCrossbindPlugin()],
    optimizeDeps: { include: ['@crossbind/extension-clipboard'] },
});
