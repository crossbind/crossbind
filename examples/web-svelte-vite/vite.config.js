import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import crossbind from 'crossbind';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [svelte(), crossbind()],
});
