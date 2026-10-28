import { spawn } from 'node:child_process';

const OPENERS = { darwin: ['open'], win32: ['cmd', '/c', 'start', '""'] };

// Opens an address in the user's browser where the system can; whoever calls it prints the address too.
export default function openUrl(url) {
    const [program, ...args] = OPENERS[process.platform] ?? ['xdg-open'];
    const opener = spawn(program, [...args, url], { stdio: 'ignore', detached: true });
    opener.on('error', () => {});
    opener.unref();
}
