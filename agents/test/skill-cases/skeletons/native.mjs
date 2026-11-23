import { cmakeLibrary, json } from './helpers.mjs';

export const NODE_SERVICE = {
    'package.json': json({
        name: 'orders-api',
        private: true,
        version: '0.9.0',
        type: 'module',
        main: 'src/server.js',
        scripts: { start: 'node src/server.js', test: 'node --test' },
        dependencies: { 'better-sqlite3': '^12.4.1', express: '^5.1.0', sharp: '^0.34.4' },
    }),
    'src/server.js': `import express from 'express';
import { thumbnails } from './routes/thumbnails.js';
import { users } from './routes/users.js';

const app = express();
app.use(express.json());
app.use('/users', users);
app.use('/thumbnails', thumbnails);

app.listen(process.env.PORT ?? 3000);
`,
    'src/db.js': `import Database from 'better-sqlite3';

export const db = new Database(process.env.DATABASE_FILE ?? 'orders.sqlite');
db.exec('create table if not exists users (id integer primary key, email text unique, password text)');
`,
    'src/routes/users.js': `import { Router } from 'express';
import { db } from '../db.js';

export const users = Router();

users.post('/', (request, response) => {
    const { email, password } = request.body;
    const { lastInsertRowid } = db.prepare('insert into users (email, password) values (?, ?)').run(email, password);
    response.status(201).json({ id: lastInsertRowid });
});

users.get('/:id', (request, response) => {
    const user = db.prepare('select id, email from users where id = ?').get(request.params.id);
    if (!user) return response.status(404).end();
    response.json(user);
});
`,
    'src/routes/thumbnails.js': `import { Router, raw } from 'express';
import sharp from 'sharp';

export const thumbnails = Router();

thumbnails.post('/', raw({ type: 'image/*', limit: '20mb' }), async (request, response) => {
    const thumbnail = await sharp(request.body).resize(320).webp().toBuffer();
    response.type('image/webp').send(thumbnail);
});
`,
};

export const ELECTRON = {
    'package.json': json({
        name: 'signal-meter',
        version: '0.3.0',
        main: 'main.js',
        scripts: { start: 'electron .', dist: 'electron-builder' },
        devDependencies: { electron: '^44.0.0', 'electron-builder': '^26.0.12' },
        build: { appId: 'com.example.signalmeter', files: ['main.js', 'preload.js', 'renderer/**'] },
    }),
    'main.js': `const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// TODO: take the level from the engine in native/ instead of this placeholder.
ipcMain.handle('level', () => Math.random());

app.whenReady().then(() => {
    const window = new BrowserWindow({ width: 640, height: 480, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
    window.loadFile('renderer/index.html');
});
`,
    'preload.js': `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meter', { level: () => ipcRenderer.invoke('level') });
`,
    'renderer/index.html': `<!doctype html>
<meta charset="UTF-8" />
<title>Signal Meter</title>
<meter id="level" min="0" max="1"></meter>
<script src="renderer.js"></script>
`,
    'renderer/renderer.js': `setInterval(async () => {
    document.querySelector('#level').value = await window.meter.level();
}, 250);
`,
    'native/CMakeLists.txt': cmakeLibrary('engine', 'src/engine.cpp'),
    'native/include/meter/engine.h': `#pragma once

#include <vector>

namespace meter {

class Engine {
public:
    explicit Engine(int sampleRate);
    void feed(const std::vector<float> &samples);
    double level() const;

private:
    int sampleRate_;
    double level_ = 0;
};

}
`,
    'native/src/engine.cpp': `#include "meter/engine.h"

#include <cmath>

namespace meter {

Engine::Engine(int sampleRate) : sampleRate_(sampleRate) {}

void Engine::feed(const std::vector<float> &samples) {
    double sum = 0;
    for (float sample : samples) sum += sample * sample;
    level_ = samples.empty() ? 0 : std::sqrt(sum / samples.size());
}

double Engine::level() const { return level_; }

}
`,
};

export const WORKER_PLAIN = {
    'package.json': json({
        name: 'uploads-worker',
        private: true,
        version: '1.2.0',
        type: 'module',
        scripts: { dev: 'wrangler dev', deploy: 'wrangler deploy' },
        devDependencies: { wrangler: '^4.45.0' },
    }),
    'wrangler.toml': `name = "uploads-worker"
main = "src/index.js"
compatibility_date = "2026-06-01"

[[kv_namespaces]]
binding = "SESSIONS"
id = "0f2ac74b498b48028cb68387c421e279"

[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "uploads"
`,
    'src/index.js': `export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === 'PUT' && url.pathname.startsWith('/uploads/')) {
            const key = url.pathname.slice('/uploads/'.length);
            await env.UPLOADS.put(key, request.body);
            return Response.json({ key }, { status: 201 });
        }
        if (url.pathname === '/api/items') {
            return fetch('https://api.example.com/items', { headers: { accept: 'application/json' } });
        }
        return new Response('Not found', { status: 404 });
    },
};
`,
};

export const LIB_CMAKE = {
    'CMakeLists.txt': `cmake_minimum_required(VERSION 3.20)
project(tilepack VERSION 1.3.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
find_package(ZLIB REQUIRED)
find_package(SQLite3 REQUIRED)

add_library(tilepack src/tilepack.cpp)
target_include_directories(tilepack PUBLIC include)
target_link_libraries(tilepack PRIVATE ZLIB::ZLIB SQLite::SQLite3)

enable_testing()
add_executable(tilepack_test tests/tilepack_test.cpp)
target_link_libraries(tilepack_test PRIVATE tilepack)
add_test(NAME tilepack_test COMMAND tilepack_test)
`,
    'include/tilepack/tilepack.h': `#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace tilepack {

struct Tile {
    int zoom;
    int column;
    int row;
    std::vector<std::uint8_t> data;
};

class Archive {
public:
    explicit Archive(const std::string &path);
    ~Archive();

    void put(const Tile &tile);
    std::shared_ptr<Tile> get(int zoom, int column, int row) const;
    int count() const;

private:
    struct State;
    std::unique_ptr<State> state_;
};

std::string version();

}
`,
    'src/tilepack.cpp': `#include "tilepack/tilepack.h"

#include <sqlite3.h>
#include <zlib.h>

namespace tilepack {

struct Archive::State {
    sqlite3 *database = nullptr;
};

Archive::Archive(const std::string &path) : state_(std::make_unique<State>()) {
    sqlite3_open(path.c_str(), &state_->database);
    sqlite3_exec(state_->database, "create table if not exists tiles (z, x, y, data blob, primary key (z, x, y))", nullptr, nullptr, nullptr);
}

Archive::~Archive() { sqlite3_close(state_->database); }

// put() deflates the tile with zlib before it stores it; get() inflates it again.

std::string version() { return "1.3.0"; }

}
`,
    'tests/tilepack_test.cpp': `#include "tilepack/tilepack.h"

#include <cassert>

int main() {
    tilepack::Archive archive(":memory:");
    archive.put({ 3, 1, 2, { 1, 2, 3, 4 } });
    assert(archive.count() == 1);
    assert(archive.get(3, 1, 2)->data.size() == 4);
    return 0;
}
`,
    LICENSE: 'MIT License\n\nCopyright (c) 2026 Example Maps\n',
    'README.md': '# tilepack\n\nA C++ library that packs map tiles into one SQLite file, deflated with zlib. Built with CMake.\n',
};

export const CPP_CLI = {
    'CMakeLists.txt': `cmake_minimum_required(VERSION 3.20)
project(wordfreq CXX)

set(CMAKE_CXX_STANDARD 17)
add_executable(wordfreq src/main.cpp src/handler.cpp)
`,
    'src/handler.h': `#pragma once

#include <string>

struct Reply {
    int status;
    std::string body;
};

// Answers one request: GET /count?text=... counts the words of the text.
Reply handle(const std::string &method, const std::string &path, const std::string &query);
`,
    'src/handler.cpp': `#include "handler.h"

#include <sstream>

Reply handle(const std::string &method, const std::string &path, const std::string &query) {
    if (method != "GET" || path != "/count") return { 404, "not found\\n" };
    std::istringstream words(query.substr(query.find('=') + 1));
    int count = 0;
    for (std::string word; words >> word;) ++count;
    return { 200, std::to_string(count) + "\\n" };
}
`,
    'src/main.cpp': `#include <fstream>
#include <iostream>
#include <map>
#include <string>

#include "handler.h"

int main(int argc, char **argv) {
    if (argc < 2) {
        std::cerr << "usage: wordfreq <file>\\n";
        return 2;
    }
    std::ifstream file(argv[1]);
    if (!file) {
        std::cerr << "wordfreq: cannot open " << argv[1] << "\\n";
        return 1;
    }
    std::map<std::string, int> counts;
    for (std::string word; file >> word;) ++counts[word];
    for (const auto &[word, count] : counts) std::cout << count << " " << word << "\\n";
    return 0;
}
`,
    'README.md': '# wordfreq\n\nCounts the words of a file. `cmake -B build && cmake --build build`, then `build/wordfreq <file>`.\n',
};

export const WASI_CROSSBIND = {
    'package.json': json({
        name: 'wordfreq',
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { build: 'crossbind build -p wasi -e wasi -b release' },
        devDependencies: { crossbind: '^2.0.0-beta.77' },
    }),
    'crossbind.config.mjs': `export default {
    general: { name: 'wordfreq' },
    paths: { config: import.meta.url, output: 'dist' },
};
`,
    'src/native/main.cpp': CPP_CLI['src/main.cpp'].replace('#include "handler.h"\n', ''),
};
