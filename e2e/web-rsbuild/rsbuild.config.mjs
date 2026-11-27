import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import crossbind from 'crossbind';

export default defineConfig({
    plugins: [pluginReact(), crossbind()],
    source: {
        entry: { index: './src/main.jsx' },
    },
    html: {
        title: 'Rsbuild + React',
    },
});
