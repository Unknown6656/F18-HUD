"use strict";


const CACHE_VERSION = Date.now();
const CACHE_NAME = `F18HUD-${CACHE_VERSION}`;
const CACHE_FILES = [
    '/index.html',
    '/css/style.css',
    '/css/glass-gauge.css',
    '/css/hornet-display.css',
    '/font/glass-gauge.ttf',
    '/font/glass-gauge.woff',
    '/font/glass-gauge.woff2',
    '/font/hornet-display-bold.ttf',
    '/font/hornet-display-bold.woff',
    '/font/hornet-display-bold.woff2',
    '/font/hornet-display-regular.ttf',
    '/font/hornet-display-regular.woff',
    '/font/hornet-display-regular.woff2',
    '/js/jquery.js',
    '/js/cookie.js',
    '/js/css-calc.js',
    '/js/airports.js',
 // '/js/offline.js',
    '/js/script.js',
];


self.addEventListener('install', event => event.waitUntil((async () =>
{
    const cache = await caches.open(CACHE_NAME);

    await cache.addAll(CACHE_FILES);

    console.log(`[${CACHE_NAME}] installed`);
})()));

self.addEventListener('fetch', event => event.respondWith((async () =>
{
    let response = await caches.match(e.request);

    console.log(`[${CACHE_NAME}] ${response ? 'cache' : 'network'}: ${e.request.url}`);

    if (!response)
    {
        response = await fetch(e.request);

        const cache = await caches.open(CACHE_NAME);

        cache.put(e.request, response.clone());
    }

    return response;
})()));

self.addEventListener('activate', event =>
{
    console.log(`[${CACHE_NAME}] installed`);
    event.waitUntil(caches.keys().then(keys =>
    {
        return Promise.all(keys.map((key) =>
        {
            if (key === CACHE_NAME)
                return;

            return caches.delete(key);
        }));
    }));
});