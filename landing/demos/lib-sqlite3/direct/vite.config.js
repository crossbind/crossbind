import { defineConfig } from 'vite';
import crossbind from 'crossbind';

// Importing a port header is what makes crossbind bind it; crossbind() links those bindings into
// .crossbind/build, which the demo build ships. The bundle itself is not used.
export default defineConfig({
    plugins: [crossbind()],
    build: { rollupOptions: { input: 'src/headers.js' } },
});
