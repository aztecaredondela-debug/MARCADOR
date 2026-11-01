const CACHE = 'marcador-sar-v15';
const ARCHIVOS = ['./', './index.html', './manifest.json', './fondo.jpg', './escudoSAR.png',
  './descanso.mp4', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    // El vídeo pesado no debe impedir la instalación si falla
    await Promise.all(ARCHIVOS.map(a => c.add(a).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Los navegadores piden el vídeo por rangos (Range); hay que responder 206 desde la caché
async function respuestaRango(req) {
  const c = await caches.open(CACHE);
  const r = await c.match(req.url, { ignoreSearch: true });
  if (!r) return fetch(req);
  const buf = await r.arrayBuffer();
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  const ini = m ? +m[1] : 0;
  const fin = m && m[2] ? +m[2] : buf.byteLength - 1;
  return new Response(buf.slice(ini, fin + 1), {
    status: 206,
    headers: {
      'Content-Type': r.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${ini}-${fin}/${buf.byteLength}`,
      'Content-Length': fin - ini + 1
    }
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) { e.respondWith(respuestaRango(req)); return; }
  const url = new URL(req.url);
  const esCodigo = req.mode === 'navigate' || /\.(html|js|json)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (esCodigo && url.origin === location.origin) {
    // Código: primero la red (así nunca se queda una versión vieja); sin conexión o red lenta (3 s), la caché
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 3000))
        ]);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const red = fetch(req).then(res => {
        if (res && res.ok && url.origin === location.origin)
          caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || red;   // imágenes/vídeo: caché primero; se actualiza en segundo plano
    })
  );
});
