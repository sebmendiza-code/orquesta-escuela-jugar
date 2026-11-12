const canUseServiceWorker = 'serviceWorker' in navigator
  && (window.isSecureContext || location.hostname === 'localhost');

// ---------- Aviso de conexión ----------
const netBanner = document.createElement('div');
netBanner.setAttribute('role', 'status');
netBanner.style.cssText = 'position:fixed;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:40;display:none;align-items:center;gap:10px;max-width:92vw;padding:8px 14px;border-radius:14px;background:rgba(8,15,38,.94);border:1px solid #5adcf5;color:#e6f7ff;font:700 12px Nunito,sans-serif;box-shadow:0 3px 12px #0007;';
document.body.appendChild(netBanner);
let updateReady = false;
let waitingWorker = null;
let reloading = false;
let infoTimer = 0;
function showInfo(message, ms = 4000) {
  if (updateReady && netBanner.querySelector('button')) return; // no tapar el aviso de actualización
  netBanner.textContent = message;
  netBanner.style.display = 'flex';
  clearTimeout(infoTimer);
  infoTimer = setTimeout(() => { if (!netBanner.querySelector('button')) netBanner.style.display = 'none'; }, ms);
}
function showOffline() {
  const ready = (() => { try { return localStorage.getItem('oefv-offline-ready'); } catch (e) { return null; } })();
  showInfo(ready ? '¡Podés seguir jugando sin Internet! Tus puntajes se guardan en este dispositivo.' : '📡 Sin conexión: el juego todavía no terminó de descargarse para jugar offline.');
}
window.addEventListener('offline', showOffline);
window.addEventListener('online', () => { if (!updateReady) netBanner.style.display = 'none'; });
if (navigator.onLine === false) showOffline();

// El service worker avisa SOLO cuando descargó todos los archivos esenciales.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'OFFLINE_READY') {
      let first = false;
      try { first = !localStorage.getItem('oefv-offline-ready'); localStorage.setItem('oefv-offline-ready', data.version); } catch (e) { /* sin almacenamiento */ }
      if (first) showInfo('✅ Listo: ya podés jugar sin conexión en este dispositivo.', 5000);
    } else if (data.type === 'OFFLINE_FAILED') {
      console.warn(`[offline] Faltan ${data.count} archivos esenciales; se reintentará.`, data.failed);
    }
  });
}

// ---------- Actualización segura ----------

// Solo se ofrece actualizar fuera de una partida (lo informa main.js).
function canApplyUpdateNow() {
  try { return typeof window.__oefvCanUpdate === 'function' ? !!window.__oefvCanUpdate() : false; } catch (e) { return false; }
}

let snoozeUntil = 0;
function showUpdateBanner() {
  if (!waitingWorker || !canApplyUpdateNow() || Date.now() < snoozeUntil) return;
  netBanner.textContent = '';
  const label = document.createElement('span');
  label.textContent = '✨ Hay una nueva versión del juego.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Actualizar';
  btn.style.cssText = 'min-height:40px;padding:0 14px;border:0;border-radius:10px;background:#22a879;color:#fff;font:800 13px Nunito,sans-serif;';
  btn.addEventListener('click', () => {
    if (!canApplyUpdateNow()) return;
    btn.disabled = true;
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
  });
  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'Luego';
  later.style.cssText = 'min-height:40px;padding:0 10px;border:0;border-radius:10px;background:#46516b;color:#fff;font:700 12px Nunito,sans-serif;';
  later.addEventListener('click', () => { netBanner.style.display = 'none'; snoozeUntil = Date.now() + 10 * 60 * 1000; });
  netBanner.append(label, btn, later);
  netBanner.style.display = 'flex';
}

function trackWaiting(worker) {
  if (!worker) return;
  waitingWorker = worker;
  updateReady = true;
  showUpdateBanner();
}

if (canUseServiceWorker) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((registration) => {
      // Solo hay "actualización" si ya existía una versión controlando la página.
      if (registration.waiting && navigator.serviceWorker.controller) trackWaiting(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') {
            if (navigator.serviceWorker.controller) trackWaiting(installing);
            else installing.postMessage({ type: 'SKIP_WAITING' }); // Primera instalación: sin recarga.
          }
        });
      });
      // Buscar versiones nuevas al volver a la app y cada 30 minutos.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) registration.update().catch(() => {}); });
      setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
      // Reintenta mostrar el aviso cuando el jugador vuelve al menú.
      setInterval(() => { if (updateReady && netBanner.style.display === 'none') showUpdateBanner(); }, 15000);
    }).catch((error) => {
      console.warn('No se pudo habilitar el modo instalable; el juego continúa online.', error);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Recarga solo si el jugador pidió actualizar (nunca durante una partida).
      if (reloading || !updateReady) return;
      reloading = true;
      location.reload();
    });
  }, { once: true });
}
