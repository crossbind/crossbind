// The part of Durable Object storage the quota uses (worker/quota.js), kept in a Map: for tests and the local API.
export function memoryStorage() {
    const data = new Map();
    return {
        data,
        async get(key) {
            return Array.isArray(key) ? new Map(key.filter((k) => data.has(k)).map((k) => [k, data.get(k)])) : data.get(key);
        },
        async put(entries) {
            Object.entries(entries).forEach(([k, v]) => data.set(k, v));
        },
        async list({ end }) {
            return new Map([...data].filter(([k]) => k < end).sort());
        },
        async delete(keys) {
            keys.forEach((k) => data.delete(k));
        },
    };
}
