import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import copyToDistSource from '../src/utils/copyToDistSource.js';

let work;

function put(relative, content = '') {
    const file = upath.join(work, relative);
    fs.mkdirSync(upath.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
}

beforeEach(() => {
    work = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-copy-source-'))));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('copyToDistSource', () => {
    test('reads a file of the package from its own directory', () => {
        const file = put('ports/openssl/linux/assets/cacert.pem');

        expect(copyToDistSource(upath.join(work, 'ports/openssl/linux'), 'assets/cacert.pem')).toBe(file);
    });

    test('reads a file of another package from the node_modules beside the package', () => {
        const file = put('ports/curl/linux/node_modules/@crossbind/port-curl/include/curl/curl_crossbind.h');

        expect(copyToDistSource(upath.join(work, 'ports/curl/linux'), 'node_modules/@crossbind/port-curl/include/curl/curl_crossbind.h'))
            .toBe(file);
    });

    // npm hoists the family package above the platform package that depends on it.
    test('finds a file of another package that npm hoisted above the package', () => {
        put('app/node_modules/@crossbind/port-curl-linux/package.json', '{"name":"@crossbind/port-curl-linux"}');
        put('app/node_modules/@crossbind/port-curl/package.json', '{"name":"@crossbind/port-curl"}');
        const file = put('app/node_modules/@crossbind/port-curl/include/curl/curl_crossbind.h');

        expect(copyToDistSource(upath.join(work, 'app/node_modules/@crossbind/port-curl-linux'), 'node_modules/@crossbind/port-curl/include/curl/curl_crossbind.h'))
            .toBe(file);
    });
});
