import { json } from './helpers.mjs';

export const SITE_VITE_REACT = {
    'package.json': json({
        name: 'example-shop',
        private: true,
        version: '1.4.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0', 'react-router-dom': '^7.9.0' },
        devDependencies: { '@vitejs/plugin-react': '^6.1.1', vite: '^8.2.1' },
    }),
    'vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()] });
`,
    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Example Shop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    'src/main.jsx': `import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Products from './pages/Products.jsx';
import Product from './pages/Product.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
    <BrowserRouter>
        <Routes>
            <Route path="/" element={<Products />} />
            <Route path="/products/:id" element={<Product />} />
        </Routes>
    </BrowserRouter>,
);
`,
    'src/api.js': `const API = 'https://api.example.com';

export async function getProducts() {
    const response = await fetch(API + '/products');
    if (!response.ok) throw new Error('Could not load the products');
    return response.json();
}

export async function getProduct(id) {
    const response = await fetch(API + '/products/' + encodeURIComponent(id));
    if (!response.ok) throw new Error('Could not load the product');
    return response.json();
}
`,
    'src/format.js': `export function formatPrice(cents, currency = 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function discounted(cents, percent) {
    return Math.round(cents * (1 - percent / 100));
}
`,
    'src/pages/Products.jsx': `import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProducts } from '../api.js';
import { formatPrice } from '../format.js';

export default function Products() {
    const [products, setProducts] = useState([]);
    useEffect(() => {
        getProducts().then(setProducts);
    }, []);
    return (
        <table>
            <thead>
                <tr><th>Product</th><th>Price</th></tr>
            </thead>
            <tbody>
                {products.map((product) => (
                    <tr key={product.id}>
                        <td><Link to={'/products/' + product.id}>{product.name}</Link></td>
                        <td>{formatPrice(product.price)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
`,
    'src/pages/Product.jsx': `import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getProduct } from '../api.js';
import { formatPrice } from '../format.js';

export default function Product() {
    const { id } = useParams();
    const [product, setProduct] = useState(null);
    useEffect(() => {
        getProduct(id).then(setProduct);
    }, [id]);
    if (!product) return <p>Loading…</p>;
    return (
        <article>
            <h1>{product.name}</h1>
            <p>{formatPrice(product.price)}</p>
            <a href={product.manufacturerUrl}>Manufacturer's site</a>
        </article>
    );
}
`,
    'src/index.css': `body { font-family: system-ui, sans-serif; margin: 2rem; }
table { border-collapse: collapse; width: 100%; }
td, th { border-bottom: 1px solid #ddd; padding: 0.5rem; text-align: left; }
`,
};

export const SITE_NEXTJS = {
    'package.json': json({
        name: 'example-store',
        private: true,
        version: '2.1.0',
        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
        dependencies: { next: '^16.2.0', react: '^19.3.0', 'react-dom': '^19.3.0' },
    }),
    'next.config.mjs': `/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
`,
    'app/layout.jsx': `export const metadata = { title: 'Example Store' };

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
`,
    'app/page.jsx': `import Link from 'next/link';
import { listProducts } from '../lib/db.js';

// Rendered on the server for every request: the prices come from the database.
export const dynamic = 'force-dynamic';

export default async function Home() {
    const products = await listProducts();
    return (
        <ul>
            {products.map((product) => (
                <li key={product.id}>
                    <Link href={'/products/' + product.id}>{product.name}</Link>
                </li>
            ))}
        </ul>
    );
}
`,
    'app/products/[id]/page.jsx': `import { notFound } from 'next/navigation';
import { getProduct } from '../../../lib/db.js';

export default async function Product({ params }) {
    const { id } = await params;
    const product = await getProduct(id);
    if (!product) notFound();
    return (
        <article>
            <h1>{product.name}</h1>
            <p>{product.description}</p>
        </article>
    );
}
`,
    'app/api/contact/route.js': `export async function POST(request) {
    const { email, message } = await request.json();
    if (!email || !message) return Response.json({ error: 'email and message are required' }, { status: 400 });
    console.log('contact', email, message.length);
    return Response.json({ ok: true });
}
`,
    'lib/db.js': `import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function listProducts() {
    const { rows } = await pool.query('select id, name from products order by name');
    return rows;
}

export async function getProduct(id) {
    const { rows } = await pool.query('select id, name, description from products where id = $1', [id]);
    return rows[0] ?? null;
}
`,
};

export const VUE_NATIVE = {
    'package.json': json({
        name: 'orbit-lab',
        private: true,
        version: '0.5.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vue-tsc --noEmit && vite build' },
        dependencies: { vue: '^3.6.2' },
        devDependencies: { '@vitejs/plugin-vue': '^6.0.1', typescript: '~6.0.3', vite: '^8.2.1', 'vue-tsc': '^3.1.2' },
    }),
    'vite.config.ts': `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({ plugins: [vue()] });
`,
    'tsconfig.json': json({
        compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true },
        include: ['src'],
    }),
    'index.html': SITE_VITE_REACT['index.html'].replace('Example Shop', 'Orbit Lab').replace('root', 'app').replace('main.jsx', 'main.ts'),
    'src/main.ts': `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
`,
    'src/App.vue': `<script setup lang="ts">
import { ref } from 'vue';

// TODO: step the simulation with the Engine class of src/native/engine.h.
const energy = ref(0);
</script>

<template>
    <p>Energy: {{ energy }}</p>
</template>
`,
    'src/native/engine.h': `#pragma once

#include <string>

class Engine {
public:
    explicit Engine(int bodies);

    void step(double seconds);
    double energy() const;
    std::string describe() const;

private:
    int bodies_;
    double energy_ = 0;
};
`,
    'src/native/engine.cpp': `#include "engine.h"

Engine::Engine(int bodies) : bodies_(bodies) {}

void Engine::step(double seconds) { energy_ += bodies_ * seconds; }

double Engine::energy() const { return energy_; }

std::string Engine::describe() const { return std::to_string(bodies_) + " bodies"; }
`,
};

export const EXPO_PLAIN = {
    'package.json': json({
        name: 'field-notes',
        version: '1.0.0',
        main: 'expo-router/entry',
        scripts: { start: 'expo start', android: 'expo run:android', ios: 'expo run:ios' },
        dependencies: {
            expo: '~58.0.14',
            'expo-router': '~58.0.23',
            'expo-status-bar': '~58.0.3',
            react: '19.3.0',
            'react-native': '0.88.1',
            'react-native-safe-area-context': '~5.10.1',
            'react-native-screens': '~4.30.0',
        },
        devDependencies: { '@types/react': '~19.3.0', typescript: '~6.0.3' },
    }),
    'app.json': json({
        expo: {
            name: 'Field Notes',
            slug: 'field-notes',
            version: '1.0.0',
            scheme: 'fieldnotes',
            ios: { bundleIdentifier: 'com.example.fieldnotes' },
            android: { package: 'com.example.fieldnotes' },
            plugins: ['expo-router'],
        },
    }),
    'app/_layout.tsx': `import { Stack } from 'expo-router';

export default function Layout() {
    return <Stack />;
}
`,
    'app/index.tsx': `import { useState } from 'react';
import { Button, FlatList, Text, TextInput, View } from 'react-native';

export default function Notes() {
    const [notes, setNotes] = useState<string[]>([]);
    const [draft, setDraft] = useState('');
    return (
        <View style={{ flex: 1, padding: 16 }}>
            <TextInput value={draft} onChangeText={setDraft} placeholder="New note" />
            <Button title="Add" onPress={() => { setNotes([draft, ...notes]); setDraft(''); }} />
            <FlatList data={notes} keyExtractor={(note, index) => String(index)} renderItem={({ item }) => <Text>{item}</Text>} />
        </View>
    );
}
`,
    'tsconfig.json': json({ extends: 'expo/tsconfig.base', compilerOptions: { strict: true } }),
};

export const MONOREPO = {
    'package.json': json({ name: 'photo-suite', private: true, packageManager: 'pnpm@10.20.0' }),
    'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
    'apps/web/package.json': json({
        name: '@photo-suite/web',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' },
        dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
        devDependencies: { '@vitejs/plugin-react': '^6.1.1', vite: '^8.2.1', vitest: '^4.0.5' },
    }),
    'apps/web/vite.config.js': SITE_VITE_REACT['vite.config.js'],
    'apps/web/index.html': SITE_VITE_REACT['index.html'].replace('Example Shop', 'Photo Suite'),
    'apps/web/src/main.jsx': `import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')).render(<input type="file" accept="image/*" />);
`,
    'apps/mobile/package.json': json({
        name: '@photo-suite/mobile',
        private: true,
        main: 'expo-router/entry',
        scripts: { start: 'expo start', ios: 'expo run:ios', android: 'expo run:android', test: 'jest' },
        dependencies: { expo: '~58.0.14', 'expo-router': '~58.0.23', react: '19.3.0', 'react-native': '0.88.1' },
        devDependencies: { jest: '^30.2.0', 'jest-expo': '~58.0.4' },
    }),
    'apps/mobile/app.json': json({
        expo: {
            name: 'Photo Suite',
            slug: 'photo-suite',
            ios: { bundleIdentifier: 'com.example.photosuite' },
            android: { package: 'com.example.photosuite' },
            plugins: ['expo-router'],
        },
    }),
    'apps/mobile/app/index.tsx': `import { Text } from 'react-native';

export default function Home() {
    return <Text>Photo Suite</Text>;
}
`,
    'native/CMakeLists.txt': `cmake_minimum_required(VERSION 3.20)
project(imgfilter CXX)

set(CMAKE_CXX_STANDARD 17)
add_library(imgfilter src/filter.cpp)
target_include_directories(imgfilter PUBLIC include)

enable_testing()
add_executable(filter_test tests/filter_test.cpp)
target_link_libraries(filter_test PRIVATE imgfilter)
add_test(NAME filter_test COMMAND filter_test)
`,
    'native/include/imgfilter/filter.h': `#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace imgfilter {

class Image {
public:
    Image(int width, int height);

    int width() const;
    int height() const;
    std::vector<std::uint8_t> pixels() const;
    void setPixels(const std::vector<std::uint8_t> &pixels);

private:
    int width_;
    int height_;
    std::vector<std::uint8_t> pixels_;
};

// A gradient of the given size, the same on every platform.
std::shared_ptr<Image> sample(int width, int height);

std::shared_ptr<Image> blur(const std::shared_ptr<Image> &image, int radius);

std::uint32_t checksum(const std::shared_ptr<Image> &image);

// Writes the image to disk as a PPM file.
void save(std::unique_ptr<Image> image, const std::string &path);

}
`,
    'native/src/filter.cpp': `#include "imgfilter/filter.h"

namespace imgfilter {

Image::Image(int width, int height) : width_(width), height_(height), pixels_(width * height * 4) {}

int Image::width() const { return width_; }
int Image::height() const { return height_; }
std::vector<std::uint8_t> Image::pixels() const { return pixels_; }
void Image::setPixels(const std::vector<std::uint8_t> &pixels) { pixels_ = pixels; }

// sample(), blur(), checksum() and save() follow.

}
`,
    'native/tests/filter_test.cpp': `#include "imgfilter/filter.h"

#include <cassert>

int main() {
    auto blurred = imgfilter::blur(imgfilter::sample(64, 64), 2);
    assert(imgfilter::checksum(blurred) == 0x5a17c3e1u);
    return 0;
}
`,
};
