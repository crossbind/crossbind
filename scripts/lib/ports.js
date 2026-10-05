import fs from 'node:fs';
import path from 'node:path';

// Layout: ports/<family>/<target>, where target is "base" (the brand package,
// @crossbind/port-<family>) or a platform (wasm, wasi, standalone-wasi, android, ios, darwin, linux, linuxmusl, win32).
export const BASE = 'base';
export const PLATFORMS = ['wasm', 'wasi', 'standalone-wasi', 'android', 'ios', 'darwin', 'linux', 'linuxmusl', 'win32'];

export const portsRoot = (root) => path.join(root, 'ports');
export const familyDir = (root, family) => path.join(portsRoot(root), family);
export const portDir = (root, family, target = BASE) => path.join(portsRoot(root), family, target);
export const portName = (family, target = BASE) => `@crossbind/port-${family}${target === BASE ? '' : `-${target}`}`;
export const familyOfName = (name) => name.replace(/^@crossbind\/port-/, '').replace(new RegExp(`-(${PLATFORMS.join('|')})$`), '');

const dirsIn = (dir) =>
    fs.existsSync(dir)
        ? fs
              .readdirSync(dir, { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .map((e) => e.name)
              .sort()
        : [];

export const listFamilies = (root) => dirsIn(portsRoot(root));

export const listPorts = (root) =>
    listFamilies(root).flatMap((family) =>
        dirsIn(familyDir(root, family)).map((target) => ({ family, target, dir: portDir(root, family, target), name: portName(family, target) })),
    );
