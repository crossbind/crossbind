import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';

// A documentation address (RFC 5737), toward which a UDP socket's connect() picks the default route's own address and
// sends nothing.
const ROUTE_PROBE = '192.0.2.1';
const ROUTE_PROBE_PORT = 53;
// The interface of a VPN or another tunnel, which a device on the developer's network does not reach this machine
// through: macOS's, Linux's and Windows' names for them.
const TUNNEL = /^(utun|tun|tap|ipsec|ppp|wg)\d*$|tailscale|wireguard|zerotier|vpn/i;
const LOOPBACK = ['localhost', '127.0.0.1', '::1'];
const EVERY_ADDRESS = ['0.0.0.0', '::'];
// fe80::/10, whose zone is an interface of the machine that names it.
const LINK_LOCAL_IPV6 = /^fe[89ab][0-9a-f]:/i;
// fc00::/7.
const UNIQUE_LOCAL_IPV6 = /^f[cd][0-9a-f]{2}:/i;
export const PREVIEW_PORT = 5173;
const PORTS_TRIED = 100;

function isLocalIpv4(address) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254);
}

// Whether the crossbind app opens a session's plain http source here: a private IPv4 address, a tailnet's among them,
// an IPv6 one in fc00::/7, or a name that ends in .local.
export function isLocalSource(host) {
    if (net.isIPv4(host)) return isLocalIpv4(host);
    if (net.isIPv6(host)) return UNIQUE_LOCAL_IPV6.test(host);
    return /\.local$/i.test(host);
}

// The local address of the default route, which no tool of the system's reads: null where there is no route.
export function defaultRouteAddress() {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.once('error', () => {
            socket.close();
            resolve(null);
        });
        socket.connect(ROUTE_PROBE_PORT, ROUTE_PROBE, () => {
            const { address } = socket.address();
            socket.close();
            resolve(address);
        });
    });
}

export const interfaceOf = (address, interfaces) => Object.entries(interfaces)
    .find(([, entries]) => (entries ?? []).some((entry) => entry.address === address))?.[0] ?? null;

// Where the dev server is for a device: the address --host names, else the default route's, and the host Vite listens
// on, that one address unless --host asks for every one; refused where no device would reach it, or the crossbind app
// would not open it.
export function previewHost(requested, routeAddress, interfaces = os.networkInterfaces()) {
    if (LOOPBACK.includes(requested)) {
        throw new Error(`crossbind: a device cannot reach this machine at ${requested}: give --host an address of this machine on the device's network, or leave --host out.`);
    }
    if (typeof requested === 'string' && LINK_LOCAL_IPV6.test(requested)) {
        throw new Error(`crossbind: a device cannot reach this machine at ${requested}, a link-local IPv6 address, which names an interface of this machine: give --host another address the device reaches, or leave --host out.`);
    }
    const isRouted = requested === undefined || EVERY_ADDRESS.includes(requested);
    const address = isRouted ? routeAddress : requested;
    if (!address) {
        throw new Error("crossbind: this machine has no network address a device could reach it at: join the device's network, or give an address with --host <address>.");
    }
    const name = interfaceOf(address, interfaces);
    if (isRouted && TUNNEL.test(name ?? '')) {
        throw new Error(`crossbind: this machine's default route goes through ${name}, a VPN, which a device on your network cannot reach: give this machine's address on the device's network with --host <address>.`);
    }
    if (!isLocalSource(address)) {
        throw new Error(`crossbind: ${address} is no local address, which alone the crossbind app opens a preview at: give --host a private IPv4 address (10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16), an IPv6 one in fc00::/7, or a name that ends in .local.`);
    }
    return { address, listen: requested ?? address, interface: name };
}

// The address as a URL holds it.
export const urlHost = (address) => (net.isIPv6(address) ? `[${address}]` : address);

// The dev server's address as the account's list keeps it, host:port with the host as a URL writes it, the one form
// crossbind cloud takes: a name in lower case, an IPv6 address shortened, and the port kept, 80 too.
export const listedAddress = (address, port) => `${new URL(`http://${urlHost(address)}`).host}:${port}`;

function isFree(host, port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
    });
}

// The port the dev server holds: the one asked for, which must be free, else the first free one from PREVIEW_PORT up.
// Vite writes it into its client before it would know of another, so the server holds it rather than moving on.
export async function previewPort(listen, requested) {
    if (requested !== undefined) {
        const port = Number(requested);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`crossbind: --port takes a port from 1 to 65535, not ${requested}.`);
        if (!(await isFree(listen, port))) throw new Error(`crossbind: port ${port} of ${listen} is taken: give another with --port, or end what holds it.`);
        return port;
    }
    for (let port = PREVIEW_PORT; port < PREVIEW_PORT + PORTS_TRIED; port += 1) {
        if (await isFree(listen, port)) return port;
    }
    throw new Error(`crossbind: no port from ${PREVIEW_PORT} to ${PREVIEW_PORT + PORTS_TRIED - 1} of ${listen} is free: give one with --port.`);
}
