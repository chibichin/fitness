const CACHE="fitness-record-v1-5-1";
const ASSETS=["./","index.html","css/app.css?v=1.5.0","js/app.js?v=1.5.0","js/storage.js?v=1.5.0","js/sync-core.js?v=1.5.0","js/cloud-config.js?v=1.5.0","js/cloud-sync.js?v=1.5.0","js/photo.js?v=1.5.0","js/photo-store.js?v=1.5.0","js/reorder.js?v=1.5.0","js/xlsx.js?v=1.5.0","manifest.json"];
self.addEventListener("install",event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)))})
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))})
self.addEventListener("fetch",event=>{if(event.request.method!=="GET"||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request)))})
