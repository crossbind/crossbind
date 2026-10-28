import { spawnSync } from 'node:child_process';

// The keychain names an upload key's password by this service, with the key's own path as the account.
const SERVICE = 'crossbind upload key';
// security -i reads a command line whose quoted words take a backslash before a quote or a backslash.
const quoted = (word) => `"${word.replace(/[\\"]/g, '\\$&')}"`;
// Windows PowerShell, which imports its core modules from its own home: a pwsh 7 parent's PSModulePath hides them.
const powershell = (script) => ['-NoProfile', '-NonInteractive', '-Command', `Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security'); ${script}`];
const STORE_DPAPI = 'ConvertTo-SecureString -String $env:CROSSBIND_KEYCHAIN_SECRET -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $env:CROSSBIND_KEYCHAIN_FILE -NoNewline';
const READ_DPAPI = "$secret = Get-Content -LiteralPath $env:CROSSBIND_KEYCHAIN_FILE -Raw | ConvertTo-SecureString; [Console]::Out.Write([System.Net.NetworkCredential]::new('', $secret).Password)";

const run = (program, args, options = {}) => spawnSync(program, args, { encoding: 'utf8', ...options });

// Each system's keychain, given the secret on stdin or in the environment, never on a command line. On Windows it is the
// user's DPAPI, in a file beside the key that only that user on that machine can read.
const KEYCHAINS = {
    darwin: {
        store: (key, secret) => run('security', ['-i'], { input: `add-generic-password -U -s ${quoted(SERVICE)} -a ${quoted(key)} -w ${quoted(secret)}\n` }),
        read: (key) => run('security', ['find-generic-password', '-s', SERVICE, '-a', key, '-w']),
    },
    win32: {
        store: (key, secret) => run('powershell.exe', powershell(STORE_DPAPI), {
            env: { ...process.env, CROSSBIND_KEYCHAIN_SECRET: secret, CROSSBIND_KEYCHAIN_FILE: `${key}.dpapi` },
        }),
        read: (key) => run('powershell.exe', powershell(READ_DPAPI), { env: { ...process.env, CROSSBIND_KEYCHAIN_FILE: `${key}.dpapi` } }),
    },
    linux: {
        store: (key, secret) => run('secret-tool', ['store', '--label', SERVICE, 'service', SERVICE, 'account', key], { input: secret }),
        read: (key) => run('secret-tool', ['lookup', 'service', SERVICE, 'account', key]),
    },
};

const keychainOf = (platform) => KEYCHAINS[platform] ?? KEYCHAINS.linux;

// Whether the system has a keychain to keep a password in: macOS and Windows always, Linux where secret-tool is.
export const hasKeychain = ({ platform = process.platform } = {}) => ['darwin', 'win32'].includes(platform) || !run('secret-tool', ['--help']).error;

// An upload key's password from the system's keychain, or null when it keeps none or there is no keychain.
export function readSecret(key, { platform = process.platform } = {}) {
    const result = keychainOf(platform).read(key);
    if (result.error || result.status !== 0) return null;
    // security ends what it prints with a newline.
    return result.stdout.replace(/\n$/, '') || null;
}

// Keeps an upload key's password in the system's keychain, and says whether it did: Linux without secret-tool and its
// service has none. A password counts as kept once it reads back, as security -i fails without an exit code.
export function storeSecret(key, secret, { platform = process.platform } = {}) {
    keychainOf(platform).store(key, secret);
    return readSecret(key, { platform }) === secret;
}
