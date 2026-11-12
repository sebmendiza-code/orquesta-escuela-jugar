// Subí APP_VERSION en cada publicación: el navegador detecta el cambio de este archivo,
// instala la versión nueva y borra las cachés de recursos anteriores.
// NUNCA toca localStorage ni IndexedDB (progreso y cola de sincronización van por separado).
const APP_VERSION = '1.3.0-bilingue';
const CACHE_PREFIX = 'oefv-pwa-';
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
// Caché de recursos externos públicos (tipografías y librería de InstantDB). No se borra entre versiones.
const EXTERNAL_CACHE = 'oefv-ext-v1';
const EXTERNAL_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'esm.sh'];

// Código del juego.
// './' no se precarga: algunos servidores (como la vista previa) lo redirigen y la descarga falla.
// Las navegaciones sin conexión responden igual con index.html (ver el manejador de fetch).
const APP_SHELL = [
  './index.html',
  './main.js',
  './salieri-escape.js',
  './music-tools.js',
  './sponsors-config.js',
  './i18n.js',
  './sync-queue.js',
  './instant_db_config.js',
  './rosebud-game-defaults.css',
  './rosebud-game-defaults.js',
  './manifest.webmanifest',
  './app-icon.svg',
  './pwa.js',
];

// Recursos: lista tomada del inventario real de assets del proyecto (no hay rutas inventadas).
// Si agregás o quitás un recurso, actualizá esta lista y subí APP_VERSION.
const ASSETS = [
  '1000709671.jpg', '1000754652.png', '1000754654-2.png', '1000754654.png', '1000754655-2.jpg', '1000754655.jpg',
  '1000754909.png', '1000755036.png', '1000755500.png', '1000761280.png', '1000761281.png', '1000761282.png',
  '1000761283.png', '1000761326.png', '1000761327.png', '1000761328.png',
  'animal-otter-violin.webp', 'animal-owl-teacher.webp', 'animal-sebastian-fox.webp',
  'audio/acierto.mp3', 'audio/aplausos.mp3', 'audio/bienvenida-orquesta.mp3',
  'audio/conduccion-2-4-sincronizado.mp3', 'audio/conduccion-2-4.mp3', 'audio/conduccion-3-4-sincronizado.mp3',
  'audio/conduccion-3-4.mp3', 'audio/conduccion-4-4-sincronizado.mp3', 'audio/conduccion-4-4.mp3',
  'audio/escape-classical-loop.mp3', 'audio/escape-jump-swish.mp3', 'audio/escape-salieri-trick.mp3',
  'audio/metallofon-c5.mp3', 'audio/metallofon-c6.mp3', 'audio/metallofon-e5.mp3', 'audio/metallofon-g5.mp3',
  'audio/musica-reconocer.mp3', 'audio/musica-ritmo.mp3', 'audio/musica-sinfonico.mp3', 'audio/musica.mp3',
  'audio/ritmo-dificil-epico.mp3', 'audio/ritmo-dificil-virtuoso.mp3', 'audio/ritmo-facil-serenata.mp3',
  'audio/ritmo-medio-pizzicato.mp3', 'audio/ritmo-medio-tango.mp3',
  'audio/sample-bandoneon.mp3', 'audio/sample-cello.mp3', 'audio/sample-clarinete.mp3', 'audio/sample-contrabajo.mp3',
  'audio/sample-fagot.mp3', 'audio/sample-flauta.mp3', 'audio/sample-oboe.mp3', 'audio/sample-timbal.mp3',
  'audio/sample-trombon.mp3', 'audio/sample-trompeta.mp3', 'audio/sample-viola.mp3', 'audio/sample-violin.mp3',
  'av-buho.webp', 'av-conejo.webp', 'av-gato.webp', 'av-leon-traje.webp', 'av-leon.webp', 'av-nutria.webp',
  'av-panda.webp', 'av-perro.webp', 'av-zorro.webp', 'bandoneon.webp',
  'bg-aula.webp', 'bg-colon.webp', 'bg-concierto.webp', 'bg-ensayo.webp', 'bg-orquesta-escuela.webp',
  'bg-scala.webp', 'bg-sidney.webp', 'bg-viena.webp',
  'carrera-buho.png', 'carrera-conejo.png', 'carrera-gato.png', 'carrera-leon.png', 'carrera-nutria.png',
  'carrera-panda.png', 'carrera-perro.png',
  'cello.webp', 'char-alumna.webp', 'char-director.webp', 'char-profe.webp', 'clarinete.webp',
  'comp-bach.webp', 'comp-beethoven.webp', 'comp-chaikovski.webp', 'comp-chopin.webp', 'comp-clara.webp',
  'comp-fanny.webp', 'comp-mozart.webp', 'comp-piazzolla.webp', 'comp-vivaldi.webp',
  'contrabajo.webp', 'director-sebastian-fox.webp',
  'escape-grand-concert-background.webp', 'escape-runner-fox.png', 'escape-salieri-villain.webp',
  'escape-salieri-wolf.png', 'escape-school-background.webp', 'escape-theater-background.webp',
  'escape-vienna-background.webp', 'fagot.webp', 'flauta.webp',
  'ic-cello.webp', 'ic-clarinete.webp', 'ic-contrabajo.webp', 'ic-fagot.webp', 'ic-flauta.webp', 'ic-oboe.webp',
  'ic-timbal.webp', 'ic-trombon.webp', 'ic-trompeta.webp', 'ic-viola.webp', 'ic-violin.webp',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'iglesia-san-juan-bautista.webp', 'info-musician-clarinet.webp', 'info-musician-flute.webp',
  'mascot-deer-double-bass.webp', 'mascot-penguin-percussion.webp', 'mascot-rabbit-trumpet.webp',
  'mascot-raccoon-cello.webp', 'mascota-buho.webp', 'mascota-nutria.webp', 'mascota-sebastian.webp',
  'oboe.webp', 'orchestra-bandoneon-musician.webp', 'orchestra-bassoon-musician.webp',
  'orchestra-french-horn-musician.webp', 'orchestra-oboe-musician.webp', 'orchestra-trombone-musician.webp',
  'orchestra-tuba-musician.webp', 'orchestra-viola-musician.webp', 'plaza-de-los-enamorados.webp',
  'salieri-cat-key-challenger.webp', 'salieri-cat-key-friendly.webp', 'salieri-cat-key-trickster.webp',
  'salieri-obstacle-bench.webp', 'salieri-obstacle-cello-case.webp', 'salieri-obstacle-drum.webp',
  'salieri-obstacle-flying-sheets.webp', 'salieri-obstacle-high-stand.webp', 'salieri-obstacle-low-stand.webp',
  'salieri-obstacle-rolling-case.webp', 'salieri-obstacle-sheet-pile.webp', 'salieri-obstacle-violin-case.webp',
  'sum-501-orquesta.webp', 'timbal.webp', 'trombon.webp', 'trompeta.webp', 'viola.webp', 'violin.webp',
].map((name) => `./assets/${name}`);

const ESSENTIAL = [...APP_SHELL, ...ASSETS];

// Externos: se intentan precargar, pero no bloquean la instalación (el juego tiene tipografías de respaldo
// y el ranking online es opcional). Los módulos internos de esm.sh se guardan al usarse por primera vez.
const OPTIONAL_EXTERNAL = [
  'https://fonts.googleapis.com/css2?family=Luckiest+Guy&family=Nunito:wght@800;900&family=Outfit:wght@500;600;700;800&display=swap',
  'https://esm.sh/@instantdb/core@0.22.155',
];

async function addWithRetry(cache, url, tries = 3) {
  let lastError = null;
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
      await cache.put(url, response);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastError;
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Descarga por tandas para no saturar conexiones móviles.
    const queue = ESSENTIAL.slice();
    const failed = [];
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const url = queue.shift();
        try { await addWithRetry(cache, url); } catch (error) { failed.push(url); }
      }
    });
    await Promise.all(workers);
    if (failed.length) {
      // No se declara "listo sin conexión" si falta algún archivo esencial: la instalación falla
      // y el navegador lo reintenta más tarde (la versión anterior sigue funcionando).
      await broadcast({ type: 'OFFLINE_FAILED', version: APP_VERSION, failed: failed.slice(0, 10), count: failed.length });
      throw new Error(`Faltan ${failed.length} archivos esenciales: ${failed.slice(0, 5).join(', ')}`);
    }
    const ext = await caches.open(EXTERNAL_CACHE);
    await Promise.all(OPTIONAL_EXTERNAL.map((url) => fetch(url, { mode: 'cors' })
      .then((res) => (res.ok ? ext.put(url, res) : null)).catch(() => {})));
    await broadcast({ type: 'OFFLINE_READY', version: APP_VERSION, files: ESSENTIAL.length });
    // No se activa sola: espera a que el juego confirme que no hay una partida en curso.
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source?.postMessage({ type: 'VERSION', version: APP_VERSION });
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function offlinePage() {
  return new Response(
    '<!DOCTYPE html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#11132b;color:#fff;font:700 16px sans-serif;text-align:center;padding:24px">'
    + '<div><div style="font-size:22px;color:#FFD52B">🎻 Sin conexión</div><p>La primera instalación de Orquesta Escuela necesita Internet. Conectate una vez y después vas a poder jugar sin conexión.</p>'
    + '<button onclick="location.reload()" style="min-height:48px;padding:0 22px;border:0;border-radius:14px;background:#22a879;color:#fff;font:800 15px sans-serif">↻ Reintentar</button></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // nunca se guardan envíos (POST) ni operaciones de la API
  const url = new URL(request.url);

  // Externos públicos: caché primero con actualización en segundo plano. La API y los websockets
  // de InstantDB (otros dominios) no se interceptan ni se guardan.
  if (url.origin !== self.location.origin) {
    if (!EXTERNAL_HOSTS.includes(url.hostname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(EXTERNAL_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(request, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      if (cached) { event.waitUntil(network); return cached; }
      return (await network) || new Response('', { status: 503, statusText: 'Offline' });
    })());
    return;
  }

  if (url.pathname.includes('/tools/')) return;
  const isAsset = url.pathname.includes('/assets/');

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Imágenes y audios: caché primero (son fijos por versión; carga instantánea y sin red).
    if (isAsset) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
    }
    // Código: red primero para recibir correcciones; la caché responde sin conexión.
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok && response.status === 200 && (response.type === 'basic' || response.type === 'default')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: true })
        || (request.mode === 'navigate' ? await cache.match('./index.html') : null);
      if (cached) return cached;
      if (request.mode === 'navigate') return offlinePage();
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
