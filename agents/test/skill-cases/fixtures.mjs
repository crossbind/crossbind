// The projects the skill cases run in. A fixture is a create-crossbind template (`template`, a key of
// tooling/create-app/src/manifest.json), which a run scaffolds under the project's `name` as its user would, or a
// few files of its own (`files`), which `extends` adds to another fixture's.

import fs from 'node:fs';
import path from 'node:path';

import { cmakeLibrary } from './skeletons/helpers.mjs';
import { CPP_CLI, ELECTRON, LIB_CMAKE, NODE_SERVICE, WASI_CROSSBIND, WORKER_PLAIN } from './skeletons/native.mjs';
import { EXPO_PLAIN, MONOREPO, SITE_NEXTJS, SITE_VITE_REACT, VUE_NATIVE } from './skeletons/web.mjs';

export const FIXTURES = {
    empty: { files: {} },
    'site-vite-react': { files: SITE_VITE_REACT },
    'site-vite-react-cpp': {
        extends: 'site-vite-react',
        files: {
            'cpp/CMakeLists.txt': cmakeLibrary('pricing', 'src/pricing.cpp'),
            'cpp/include/pricing/pricing.h': `#pragma once

#include <string>
#include <vector>

namespace pricing {

struct Line {
    std::string sku;
    int quantity;
    long long unitCents;
};

// The total of a cart in cents, with the volume discounts applied.
long long total(const std::vector<Line> &lines);

}
`,
            'cpp/src/pricing.cpp': `#include "pricing/pricing.h"

namespace pricing {

long long total(const std::vector<Line> &lines) {
    long long sum = 0;
    for (const Line &line : lines) {
        long long amount = line.quantity * line.unitCents;
        if (line.quantity >= 10) amount -= amount / 10;
        sum += amount;
    }
    return sum;
}

}
`,
        },
    },
    'site-nextjs': { files: SITE_NEXTJS },
    'site-nextjs-cpp': {
        extends: 'site-nextjs',
        files: {
            'native/CMakeLists.txt': cmakeLibrary('geometry', 'src/geometry.cpp'),
            'native/include/geometry/geometry.h': `#pragma once

#include <vector>

namespace geometry {

struct Point {
    double x;
    double y;
};

double area(const std::vector<Point> &polygon);
bool contains(const std::vector<Point> &polygon, Point point);

}
`,
            'native/src/geometry.cpp': `#include "geometry/geometry.h"

#include <cmath>

namespace geometry {

double area(const std::vector<Point> &polygon) {
    double twice = 0;
    for (std::size_t i = 0; i < polygon.size(); ++i) {
        const Point &a = polygon[i];
        const Point &b = polygon[(i + 1) % polygon.size()];
        twice += a.x * b.y - b.x * a.y;
    }
    return std::fabs(twice) / 2;
}

// contains() casts a ray from the point and counts the edges it crosses.

}
`,
        },
    },
    'vue-native': { files: VUE_NATIVE },
    'expo-plain': { files: EXPO_PLAIN },
    'node-service': { files: NODE_SERVICE },
    'node-service-cpp': {
        extends: 'node-service',
        files: {
            'native/scoring.h': `#pragma once

#include <vector>

// A fraud score between 0 and 1 for the amounts of a customer's recent orders, in cents.
double fraudScore(const std::vector<long long> &amounts);
`,
            'native/scoring.cpp': `#include "scoring.h"

double fraudScore(const std::vector<long long> &amounts) {
    if (amounts.empty()) return 0;
    long long largest = 0;
    long long sum = 0;
    for (long long amount : amounts) {
        sum += amount;
        if (amount > largest) largest = amount;
    }
    return sum == 0 ? 0 : static_cast<double>(largest) / sum;
}
`,
        },
    },
    electron: { files: ELECTRON },
    'worker-plain': { files: WORKER_PLAIN },
    'lib-cmake': { files: LIB_CMAKE },
    'cpp-cli': { files: CPP_CLI },
    'wasi-crossbind': { files: WASI_CROSSBIND },
    monorepo: { files: MONOREPO },
    app: { template: 'desktop-app', name: 'tide-tables' },
    'web-crossbind': { template: 'web-react-vite', name: 'matrix-lab' },
    'rn-crossbind': { template: 'mobile-reactnative-cli', name: 'trail-log' },
    'node-crossbind-wasm': { template: 'backend-nodejs-wasm', name: 'rates-service' },
    'worker-crossbind': { template: 'cloud-cloudflare-worker', name: 'edge-resizer' },
};

export function fixtureFiles(name) {
    const fixture = FIXTURES[name];
    if (!fixture) throw new Error(`Unknown fixture: ${name}`);
    if (fixture.template) throw new Error(`Fixture ${name} is the template ${fixture.template}, which has no files of its own`);
    return { ...(fixture.extends ? fixtureFiles(fixture.extends) : {}), ...fixture.files };
}

export function writeFixture(name, directory) {
    for (const [file, content] of Object.entries(fixtureFiles(name))) {
        const target = path.join(directory, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
}
