// Spike: the service worker the host serves at a key's origin, where its script's request reaches the host. It answers
// under-sw.txt itself, and fetches what the page asks it to, as a service worker's own requests go.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
    if (new URL(event.request.url).pathname === '/spike/under-sw.txt') event.respondWith(new Response('the service worker the host served'));
});
self.addEventListener('message', (event) => {
    event.waitUntil((async () => {
        const results = {};
        for (const url of event.data.urls) {
            try {
                const response = await fetch(url);
                results[url] = `${response.status} ${(await response.text()).slice(0, 80)}`;
            } catch (error) {
                results[url] = `error: ${error.message}`;
            }
        }
        event.source.postMessage(results);
    })());
});
