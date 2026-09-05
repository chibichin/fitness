const CACHE="fitness-record-v1-4-16";
const ASSETS=["./","index.html","css/app.css?v=1.4.16","js/app.js?v=1.4.16","js/storage.js?v=1.4.16","js/photo.js?v=1.4.16","js/photo-store.js?v=1.4.16","js/reorder.js?v=1.4.16","js/xlsx.js?v=1.4.16","manifest.json"];
self.addEventListener("install",event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)))})
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))})
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request)))})
