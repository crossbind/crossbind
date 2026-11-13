import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { licenses } from '../src/licenses/index.js';

const LIST = [{ name: 'gdal', version: '3.13.3', license: 'MIT', source: null, text: '=== LICENSE.TXT ===\n\nMIT' }];
const fetchMock = vi.fn();
const requested = () => String(fetchMock.mock.calls[0][0]);

beforeEach(() => {
    vi.stubGlobal('document', { baseURI: 'crossbind://app/index.html' });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
});

describe('licenses', () => {
    test('reads the list a build wrote beside the page', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(LIST), { headers: { 'content-type': 'application/json' } }));

        expect(await licenses()).toEqual(LIST);
        expect(requested()).toBe('crossbind://app/crossbind-licenses.json');
    });

    test('reads it under the base Vite serves the page from', async () => {
        vi.stubEnv('BASE_URL', '/geosmith/');
        vi.stubGlobal('document', { baseURI: 'https://example.org/geosmith/settings' });
        fetchMock.mockResolvedValue(new Response('[]'));

        await licenses();

        expect(requested()).toBe('https://example.org/geosmith/crossbind-licenses.json');
    });

    test('says where the list comes from when the server answers with the page, as a dev server does', async () => {
        fetchMock.mockResolvedValue(new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }));

        await expect(licenses()).rejects.toThrow(/crossbind-licenses\.json holds no license list.*the dev server has none/);
    });

    test('says so when the page has no list beside it', async () => {
        fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));

        await expect(licenses()).rejects.toThrow(/crossbind-licenses\.json holds no license list/);
    });
});
