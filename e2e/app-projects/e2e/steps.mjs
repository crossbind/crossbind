// What the fixture's page, its hooks and e2e/run.mjs share: the ports on the device's loopback, which adb reverse forwards
// on Android, of the run's endpoint, which the hooks ask for each step, and of the stand-in cloud and its snapshot host.
// Each is below the ports a system gives a process's own connections, which another connection may hold: Linux's from
// 32768, macOS's and Windows' from 49152.
export const ENDPOINT_PORT = 27841;
export const CLOUD_PORT = 27843;
export const SNAPSHOTS_PORT = 27844;
export const ENDPOINT = `http://127.0.0.1:${ENDPOINT_PORT}`;
export const CLOUD = Object.freeze({ cloud: `http://127.0.0.1:${CLOUD_PORT}`, snapshots: `http://127.0.0.1:${SNAPSHOTS_PORT}` });
