import { describe, expect, test } from 'vitest';
import net from 'node:net';
import {
    PREVIEW_PORT, isLocalSource, listedAddress, previewHost, previewPort, urlHost,
} from '../src/utils/previewAddress.js';

const entry = (address) => [{ address, family: net.isIPv6(address) ? 'IPv6' : 'IPv4', internal: false }];
const interfaces = {
    lo0: entry('127.0.0.1'), en0: entry('192.168.1.6'), utun3: entry('10.8.0.2'), 'Tailscale': entry('100.101.1.2'), en1: entry('fd00::6'),
};

describe('the address a device reaches the dev server at', () => {
    test("is the default route's, on its interface, listened on alone", () => {
        expect(previewHost(undefined, '192.168.1.6', interfaces)).toEqual({ address: '192.168.1.6', listen: '192.168.1.6', interface: 'en0' });
    });

    test("listens on every address where --host asks for them, the default route's still the one a device opens", () => {
        expect(previewHost('0.0.0.0', '192.168.1.6', interfaces)).toEqual({ address: '192.168.1.6', listen: '0.0.0.0', interface: 'en0' });
    });

    test('takes the local address --host names, and a .local name', () => {
        expect(previewHost('fd00::6', null, interfaces)).toEqual({ address: 'fd00::6', listen: 'fd00::6', interface: 'en1' });
        expect(previewHost('mac.local', null, interfaces)).toEqual({ address: 'mac.local', listen: 'mac.local', interface: null });
    });

    test('stops at a default route through a VPN, which a device on the network does not reach', () => {
        expect(() => previewHost(undefined, '10.8.0.2', interfaces)).toThrow("this machine's default route goes through utun3, a VPN");
        expect(() => previewHost(undefined, '100.101.1.2', interfaces)).toThrow('goes through Tailscale, a VPN');
    });

    test('stops where no device reaches this machine, or the crossbind app would not open it', () => {
        expect(() => previewHost(undefined, null, interfaces)).toThrow('this machine has no network address a device could reach it at');
        for (const loopback of ['localhost', '127.0.0.1', '::1']) expect(() => previewHost(loopback, null, interfaces)).toThrow(`a device cannot reach this machine at ${loopback}`);
        expect(() => previewHost('fe80::1', null, interfaces)).toThrow('a link-local IPv6 address');
        expect(() => previewHost('8.8.8.8', null, interfaces)).toThrow('8.8.8.8 is no local address');
        expect(() => previewHost('mac', null, interfaces)).toThrow('mac is no local address');
        expect(() => previewHost(undefined, '203.0.113.5', interfaces)).toThrow('203.0.113.5 is no local address');
    });

    test("is local as the crossbind app takes a session's source", () => {
        for (const local of ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.0.1', '100.64.0.1', '100.127.1.1', '169.254.1.1', 'fc00::1', 'fdab::1', 'Mac.local']) {
            expect(isLocalSource(local)).toBe(true);
        }
        for (const other of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1', 'fc::1', '2001:db8::1', 'mac', 'mac.localhost']) {
            expect(isLocalSource(other)).toBe(false);
        }
    });

    test('writes an IPv6 address in brackets, as a URL holds it', () => {
        expect(urlHost('fd00::6')).toBe('[fd00::6]');
        expect(urlHost('192.168.1.6')).toBe('192.168.1.6');
    });

    test("lists the address with its port in the one form crossbind cloud takes, as a URL writes it", () => {
        expect(listedAddress('192.168.1.6', 5173)).toBe('192.168.1.6:5173');
        expect(listedAddress('MyMac.local', 5173)).toBe('mymac.local:5173');
        expect(listedAddress('FD00:0:0:0::6', 5174)).toBe('[fd00::6]:5174');
        expect(listedAddress('10.0.0.2', 80)).toBe('10.0.0.2:80');
    });
});

describe('the port it holds', () => {
    test('is the one asked for when it is free, and stops when it is taken', async () => {
        const taken = net.createServer();
        await new Promise((done) => { taken.listen({ host: '127.0.0.1', port: 0 }, done); });
        const { port } = taken.address();
        try {
            await expect(previewPort('127.0.0.1', String(port))).rejects.toThrow(`port ${port} of 127.0.0.1 is taken`);
        } finally {
            await new Promise((done) => { taken.close(done); });
        }
        expect(await previewPort('127.0.0.1', String(port))).toBe(port);
    });

    test('is a port alone', async () => {
        for (const odd of ['0', '65536', 'x', '51.5']) await expect(previewPort('127.0.0.1', odd)).rejects.toThrow('--port takes a port from 1 to 65535');
    });

    test(`is the first free one from ${PREVIEW_PORT} up without one`, async () => {
        expect(await previewPort('127.0.0.1')).toBeGreaterThanOrEqual(PREVIEW_PORT);
    });
});
