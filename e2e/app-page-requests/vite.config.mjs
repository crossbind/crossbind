import { defineConfig } from 'vite';
import crossbind from 'crossbind';

export default defineConfig({
    plugins: [crossbind()],
});
