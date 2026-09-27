import { defineConfig } from 'vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

// Importing a port header is what makes crossbind bind it; the plugin links those bindings into
// .crossbind/build, which the demo build ships. The bundle itself is not used.
export default defineConfig({
    plugins: [viteCrossbindPlugin()],
    build: { rollupOptions: { input: 'src/headers.js' } },
});
