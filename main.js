import { INSTANT_DB_APP_ID } from './instant_db_config.js';
import { SalieriEscapeGame } from './salieri-escape.js';
import { createSyncQueue, kvSet } from './sync-queue.js';
import { openTuner, openMetronome, openSponsors, maybeShowSponsorIntro, setMusicToolHooks } from './music-tools.js';
import { t, getLang, setLang, onLangChange, SLOGAN_EN } from './i18n.js';

let instantDbInit = null;
let instantId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- Setup ----------
const container = document.getElementById('game-container');
const LOCAL_PROGRESS_SNAPSHOT_KEY = 'oefv-progress-snapshot-v1';

// ---------- Lectura segura del almacenamiento local ----------
// Acceso protegido: algunos WebView bloquean localStorage y lanzan excepciones.
function storageGet(key) {
  try { return localStorage.getItem(key); } catch (error) {
    console.warn(`[guardado] No se pudo leer "${key}".`, error);
    return null;
  }
}
let lastStorageWriteFailureAt = 0;
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (error) {
    console.warn(`[guardado] No se pudo escribir "${key}".`, error);
    lastStorageWriteFailureAt = Date.now();
    notifyStorageWriteFailure();
    return false;
  }
}
// Aviso visible (limitado a uno cada pocos segundos) cuando falla un guardado.
let lastStorageWarningAt = 0;
function notifyStorageWriteFailure() {
  const now = Date.now();
  if (now - lastStorageWarningAt < 4000) return;
  lastStorageWarningAt = now;
  try {
    saveStatusBadge.textContent = '⚠ No se pudo guardar en este dispositivo (almacenamiento lleno o bloqueado)';
    saveStatusBadge.style.opacity = '1';
    window.clearTimeout(saveStatusTimer);
    saveStatusTimer = window.setTimeout(() => { saveStatusBadge.style.opacity = '0'; }, 5000);
  } catch (error) { /* El aviso aún no existe durante el arranque temprano. */ }
}
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
// Lee JSON validado. Si está dañado: intenta el respaldo local, guarda una copia del
// dato dañado en "<clave>-corrupt-backup" y usa el valor por defecto SOLO para esa clave.
const CORRUPT_BACKUP_SUFFIX = '-corrupt-backup';
function readStoredJSON(key, fallback, validate = () => true) {
  const clone = () => JSON.parse(JSON.stringify(fallback));
  const raw = storageGet(key);
  if (raw === null || raw === '') return clone();
  try {
    const parsed = JSON.parse(raw);
    if (validate(parsed)) return parsed;
    throw new Error('estructura inesperada');
  } catch (error) {
    console.warn(`[guardado] Dato dañado en "${key}" (${error.message}). Se intentará recuperar.`);
    // Conserva la PRIMERA copia dañada: nunca se sobrescribe una copia existente.
    const backupKey = `${key}${CORRUPT_BACKUP_SUFFIX}`;
    const existingBackup = storageGet(backupKey);
    const backupSafe = existingBackup !== null || storageSet(backupKey, raw);
    try {
      const snapshot = JSON.parse(storageGet(LOCAL_PROGRESS_SNAPSHOT_KEY) || 'null');
      const backupRaw = snapshot?.values?.[key];
      if (typeof backupRaw === 'string' && backupRaw !== raw) {
        const recovered = JSON.parse(backupRaw);
        if (validate(recovered)) {
          if (backupSafe) storageSet(key, backupRaw);
          console.warn(`[guardado] "${key}" recuperado desde el respaldo local.`);
          return recovered;
        }
      }
    } catch (snapshotError) { /* El respaldo tampoco es utilizable. */ }
    // Solo se reemplaza el dato dañado si su copia quedó resguardada.
    const value = clone();
    if (backupSafe) storageSet(key, JSON.stringify(value));
    return value;
  }
}

function restoreMissingProgressKeys() {
  try {
    const snapshot = JSON.parse(storageGet(LOCAL_PROGRESS_SNAPSHOT_KEY) || 'null');
    if (!snapshot?.values) return;
    Object.entries(snapshot.values).forEach(([key, value]) => {
      if (key.startsWith('oefv-') && key !== LOCAL_PROGRESS_SNAPSHOT_KEY && storageGet(key) === null) {
        storageSet(key, value);
      }
    });
  } catch (error) {
    console.warn('No se pudo recuperar el respaldo local del juego.', error);
  }
}
restoreMissingProgressKeys();
const saveStatusBadge = document.createElement('div');
saveStatusBadge.setAttribute('role', 'status');
saveStatusBadge.setAttribute('aria-live', 'polite');
saveStatusBadge.textContent = '💾 Guardado en este dispositivo · nube de progreso no configurada';
saveStatusBadge.style.cssText = 'position:fixed;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));z-index:12;max-width:68vw;padding:5px 9px;border:1px solid rgba(147,220,255,.55);border-radius:999px;background:rgba(8,15,38,.78);color:#e6f7ff;font:600 10px Nunito, sans-serif;line-height:1.25;text-align:center;pointer-events:none;box-shadow:0 2px 9px #0005;opacity:0;transition:opacity .2s ease;';
document.body.appendChild(saveStatusBadge);
let saveStatusTimer = 0;
const canvas = document.createElement('canvas');
canvas.tabIndex = 0;
canvas.setAttribute('role', 'application');
canvas.setAttribute('aria-label', 'Orquesta Escuela: juego musical');
canvas.style.outline = 'none';
container.appendChild(canvas);
const ctx = canvas.getContext('2d');
let W = 0;
let H = 0;
let U = 1;
const safeAreaProbe = document.createElement('div');
safeAreaProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px);padding-right:env(safe-area-inset-right, 0px);padding-bottom:env(safe-area-inset-bottom, 0px);padding-left:env(safe-area-inset-left, 0px);';
document.body.appendChild(safeAreaProbe);
let safeTopInset = 0;
let safeRightInset = 0;
let safeBottomInset = 0;
let safeLeftInset = 0;
let gameViewportLeft = 0;
let gameViewportTop = 0;
let welcomeLayout = false;
let welcomePortraitLayout = false;
let invitationLayout = false;
let orchestraInfoLayout = false;
let orchestraInfoPortraitLayout = false;
let runnerLayout = false;
let creditsLayout = false;
let creditsElapsed = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const safeInsets = getComputedStyle(safeAreaProbe);
  safeTopInset = parseFloat(safeInsets.paddingTop) || 0;
  safeRightInset = parseFloat(safeInsets.paddingRight) || 0;
  safeBottomInset = parseFloat(safeInsets.paddingBottom) || 0;
  safeLeftInset = parseFloat(safeInsets.paddingLeft) || 0;
  const availableWidth = Math.max(1, viewportWidth - safeLeftInset - safeRightInset);
  const availableHeight = Math.max(1, viewportHeight - safeTopInset - safeBottomInset);
  welcomePortraitLayout = welcomeLayout && availableWidth / availableHeight < 1;
  orchestraInfoPortraitLayout = orchestraInfoLayout && availableWidth / availableHeight < 1;
  if (runnerLayout) {
    // Use the complete safe viewport for the runner; artwork keeps its own aspect ratio while the scene is cropped responsively.
    W = availableWidth;
    H = availableHeight;
  } else if (welcomeLayout) {
    // Bienvenida (vertical u horizontal): usa todo el área segura; el fondo se recorta tipo "cover"
    // y la distribución se calcula sobre W/H reales, sin bandas negras por forzar 16:9.
    W = availableWidth;
    H = availableHeight;
  } else if (orchestraInfoPortraitLayout) {
    W = availableWidth;
    H = availableHeight;
  } else if (invitationLayout || orchestraInfoLayout || creditsLayout) {
    const cinematicAspect = 16 / 9;
    if (availableWidth / availableHeight > cinematicAspect) {
      H = availableHeight;
      W = H * cinematicAspect;
    } else {
      W = availableWidth;
      H = W / cinematicAspect;
    }
  } else {
    W = availableWidth;
    H = availableHeight;
    if (!welcomeLayout && availableWidth > availableHeight) W = Math.min(availableWidth, availableHeight * 9 / 16);
  }
  gameViewportLeft = safeLeftInset + (availableWidth - W) / 2;
  gameViewportTop = safeTopInset + (availableHeight - H) / 2;
  canvas.width = viewportWidth * dpr;
  canvas.height = viewportHeight * dpr;
  canvas.style.width = viewportWidth + 'px';
  canvas.style.height = viewportHeight + 'px';
  canvas.style.background = '#090b19';
  ctx.setTransform(dpr, 0, 0, dpr, gameViewportLeft * dpr, gameViewportTop * dpr);
  U = runnerLayout
    ? Math.min(W / 400, H / 225)
    : orchestraInfoLayout
    ? orchestraInfoPortraitLayout ? Math.min(W / 400, H / 760) : Math.min(W / 400, 1)
    : invitationLayout || creditsLayout
      ? Math.min(W / 400, 1)
      : welcomeLayout
      ? Math.min(W / 400, H / (welcomePortraitLayout ? 720 : 225))
      : Math.min(W / 400, H / 720);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

function loadImg(name, extension = 'webp') {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = `assets/${name}.${extension}`;
  return img;
}
function loadChromaKeySprite(name) {
  const source = loadImg(name);
  const sprite = new Image();
  source.addEventListener('load', () => {
    try {
      const cutout = document.createElement('canvas');
      cutout.width = source.naturalWidth;
      cutout.height = source.naturalHeight;
      const cutoutContext = cutout.getContext('2d', { willReadFrequently: true });
      cutoutContext.drawImage(source, 0, 0);
      const frame = cutoutContext.getImageData(0, 0, cutout.width, cutout.height);
      const pixels = frame.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const red = pixels[i];
        const green = pixels[i + 1];
        const blue = pixels[i + 2];
        const greenDominance = green - Math.max(red, blue);
        if (greenDominance <= 16) continue;
        const alpha = Math.max(0, 1 - greenDominance / 255);
        if (alpha < 0.025) {
          pixels[i + 3] = 0;
          continue;
        }
        pixels[i] = Math.min(255, Math.round(red / alpha));
        pixels[i + 1] = Math.max(0, Math.min(255, Math.round((green - (1 - alpha) * 255) / alpha)));
        pixels[i + 2] = Math.min(255, Math.round(blue / alpha));
        pixels[i + 3] = Math.round(pixels[i + 3] * alpha);
      }
      cutoutContext.putImageData(frame, 0, 0);
      sprite.src = cutout.toDataURL('image/png');
    } catch (error) {
      console.warn(`No se pudo recortar el fondo verde de assets/${name}.webp; se usará la imagen original.`, error);
      sprite.src = source.src;
    }
  }, { once: true });
  // Reintenta cargas fallidas (red móvil inestable); si sigue fallando, se usan las otras poses.
  let retries = 0;
  source.addEventListener('error', () => {
    if (retries < 3) {
      retries += 1;
      setTimeout(() => { source.src = `assets/${name}.webp?retry=${retries}`; }, 600 * retries);
    } else {
      console.warn(`No se pudo cargar assets/${name}.webp; Salieri usará otra pose disponible.`);
    }
  });
  return sprite;
}
const ESCAPE_BACKGROUNDS = [
  loadImg('escape-school-background'),
  loadImg('escape-theater-background'),
  loadImg('escape-vienna-background'),
  loadImg('escape-grand-concert-background'),
];
const CREDITS_FOX = loadImg('director-sebastian-fox');
CREDITS_FOX.addEventListener('error', () => console.error('No se pudo cargar la ilustración del zorro director para los créditos.'), { once: true });
const ESCAPE_RUNNER_FOX = loadImg('escape-runner-fox', 'png');
const ESCAPE_SALIERI_CHALLENGER = loadChromaKeySprite('salieri-cat-key-challenger');
const ESCAPE_SALIERI_TRICKSTER = loadChromaKeySprite('salieri-cat-key-trickster');
const ESCAPE_SALIERI_FRIENDLY = loadChromaKeySprite('salieri-cat-key-friendly');
const ESCAPE_SALIERI_POSES = {
  challenger: ESCAPE_SALIERI_CHALLENGER,
  trickster: ESCAPE_SALIERI_TRICKSTER,
  friendly: ESCAPE_SALIERI_FRIENDLY,
};
const ESCAPE_OBSTACLE_SPRITES = {
  'low-stand': loadImg('salieri-obstacle-low-stand'),
  'high-stand': loadImg('salieri-obstacle-high-stand'),
  'violin-case': loadImg('salieri-obstacle-violin-case'),
  'cello-case': loadImg('salieri-obstacle-cello-case'),
  bench: loadImg('salieri-obstacle-bench'),
  drum: loadImg('salieri-obstacle-drum'),
  'sheet-pile': loadImg('salieri-obstacle-sheet-pile'),
  'rolling-case': loadImg('salieri-obstacle-rolling-case'),
  'flying-sheets': loadImg('salieri-obstacle-flying-sheets'),
};
ESCAPE_RUNNER_FOX.addEventListener('error', () => console.error('No se pudo cargar el sprite assets/escape-runner-fox.png; se usará el avatar de zorro del perfil.'), { once: true });
Object.entries(ESCAPE_SALIERI_POSES).forEach(([pose, image]) => image.addEventListener('error', () => {
  console.error(`No se pudo procesar la pose ${pose} de Salieri; se usará otra pose disponible del gato.`);
}, { once: true }));

// Avatares 3D: los tres primeros también son las mascotas del juego.
const AVATARS = [
  { name: 'Zorro', img: loadImg('av-zorro') },
  { name: 'Nutria', img: loadImg('av-nutria') },
  { name: 'Búho', img: loadImg('av-buho') },
  { name: 'Gato', img: loadImg('av-gato') },
  { name: 'Perro', img: loadImg('av-perro') },
  { name: 'Panda', img: loadImg('av-panda') },
  { name: 'Conejo', img: loadImg('av-conejo') },
  { name: 'León', img: loadImg('av-leon') },
];
// Imágenes en postura de carrera para Escapando de Salieri, en el mismo orden que AVATARS.
const RUNNER_SPRITES = [
  null, // Zorro: usa ESCAPE_RUNNER_FOX
  loadImg('carrera-nutria', 'png'),
  loadImg('carrera-buho', 'png'),
  loadImg('carrera-gato', 'png'),
  loadImg('carrera-perro', 'png'),
  loadImg('carrera-panda', 'png'),
  loadImg('carrera-conejo', 'png'),
  loadImg('carrera-leon', 'png'),
];
// Devuelve [imagen de carrera, respaldo del mismo animal, proporción] para el avatar del perfil.
function runnerAvatarFor(index) {
  const i = Number(index);
  const avatar = AVATARS[i] || AVATARS[0];
  if (!AVATARS[i] || i === 0) return [ESCAPE_RUNNER_FOX, AVATARS[0].img, 1448 / 1086];
  return [RUNNER_SPRITES[i] || avatar.img, avatar.img, null];
}
let runnerAvatarIndex = null;
function syncRunnerAvatar(force = false) {
  const index = Number(profile.avatar) || 0;
  if (!force && index === runnerAvatarIndex) return;
  runnerAvatarIndex = index;
  salieriRunner.setAvatar(...runnerAvatarFor(index));
}
const CHARACTERS = [
  { name: 'Sebastián, el zorro director', img: loadImg('director-sebastian-fox') },
  { name: 'Nutria violinista', img: AVATARS[1].img },
  { name: 'Búho profesor', img: AVATARS[2].img },
];
const SCHOOL_BACKGROUND = loadImg('bg-orquesta-escuela');
const SCHOOL_LOGO = loadImg('1000754655-2', 'jpg');
const INTRO_ART = loadImg('1000754652', 'png');
const MENU_MASCOTS = [
  loadImg('director-sebastian-fox'),
  loadImg('mascot-penguin-percussion'),
  loadImg('mascota-buho'),
  loadImg('mascot-rabbit-trumpet'),
  loadImg('mascot-raccoon-cello'),
  loadImg('mascot-deer-double-bass'),
];
const STAGES = [
  { name: 'Teatro Colón', city: 'Buenos Aires', img: loadImg('bg-colon') },
  { name: 'Ópera de Sídney', city: 'Australia', img: loadImg('bg-sidney') },
  { name: 'Musikverein', city: 'Viena', img: loadImg('bg-viena') },
  { name: 'Teatro alla Scala', city: 'Milán', img: loadImg('bg-scala') },
  { name: 'Iglesia San Juan Bautista', city: 'Florencio Varela', img: loadImg('iglesia-san-juan-bautista') },
  { name: 'Plaza de los Enamorados', city: 'Florencio Varela', img: loadImg('plaza-de-los-enamorados') },
  { name: 'SUM 501', city: 'Florencio Varela', img: loadImg('sum-501-orquesta') },
];
const STAGE_UNLOCKS = [
  { name: 'Teatro Colón', minPts: 0, minWins: 0, label: 'Libre' },
  { name: 'Ópera de Sídney', minPts: 0, minWins: 0, label: 'Libre' },
  { name: 'Musikverein', minPts: 0, minWins: 0, label: 'Libre' },
  { name: 'Teatro alla Scala', minPts: 1000, minWins: 2, label: '1.000 pts o 2 victorias' },
  { name: 'Iglesia San Juan Bautista', minPts: 2500, minWins: 4, label: '2.500 pts o 4 victorias' },
  { name: 'Plaza de los Enamorados', minPts: 5000, minWins: 7, label: '5.000 pts o 7 victorias' },
  { name: 'SUM 501', minPts: 8000, minWins: 10, label: '8.000 pts o 10 victorias' },
];
let gamesWon = Number(storageGet('oefv-wins') || 0);
function recordGameWin() {
  gamesWon++;
  try { storageSet('oefv-wins', String(gamesWon)); } catch (e) {}
  saveProgressLocally();
}
function isStageUnlocked(index) {
  if (index < 3) return true; // Siempre 3 escenarios libres
  const u = STAGE_UNLOCKS[index];
  if (!u) return true;
  return totalPoints >= u.minPts || gamesWon >= u.minWins;
}
const BG = { ensayo: STAGES[2].img, aula: STAGES[3].img, concierto: STAGES[0].img };
let selectedStage = 0;
const AWARDS = [
  { min: 0, name: 'Aprendiz de Corchea', icon: '🎵' },
  { min: 500, name: 'Semicorchea Veloz', icon: '⚡' },
  { min: 1500, name: 'Atril de Plata', icon: '🥈' },
  { min: 3000, name: 'Solista Estrella', icon: '⭐' },
  { min: 6000, name: 'Concertino Brillante', icon: '🎻' },
  { min: 10000, name: 'Maestro Musical', icon: '🎼' },
  { min: 16000, name: 'Batuta de Oro', icon: '🥇' },
  { min: 25000, name: 'Genio Mozart', icon: '👑' },
  { min: 40000, name: 'Leyenda Beethoven', icon: '🔥' },
];
function awardFor(points) {
  let a = AWARDS[0];
  AWARDS.forEach((x) => { if (points >= x.min) a = x; });
  return a;
}
const FONT = "'Nunito', 'Outfit', sans-serif";
const TITLE_FONT = "'Luckiest Guy', 'Nunito', sans-serif";
const COMPOSERS = [
  { name: 'Mozart', img: loadImg('comp-mozart') },
  { name: 'Beethoven', img: loadImg('comp-beethoven') },
  { name: 'Chaikovski', img: loadImg('comp-chaikovski') },
  { name: 'Piazzolla', img: loadImg('comp-piazzolla') },
  { name: 'Clara Schumann', img: loadImg('comp-clara') },
  { name: 'Fanny Mendelssohn', img: loadImg('comp-fanny') },
];
const INSTRUMENTS = [
  { name: 'Violín', img: loadImg('violin'), sample: 'violin', family: 'Cuerdas frotadas', clue: 'Registro agudo y brillante; el arco hace vibrar sus cuerdas.' },
  { name: 'Trompeta', img: loadImg('trompeta'), sample: 'trompeta', family: 'Viento-metal', clue: 'Timbre potente y claro; el sonido nace en los labios.' },
  { name: 'Flauta', img: loadImg('flauta'), sample: 'flauta', family: 'Viento-madera', clue: 'Sonido aireado y luminoso; se sopla por una embocadura.' },
  { name: 'Timbal', img: loadImg('timbal'), sample: 'timbal', family: 'Percusión', clue: 'Tambor de tono definido: se toca con mazas.' },
  { name: 'Cello', img: loadImg('cello'), sample: 'cello', family: 'Cuerdas frotadas', clue: 'Sonido cálido y grave; se toca sentado, entre las rodillas.' },
  { name: 'Clarinete', img: loadImg('clarinete'), sample: 'clarinete', family: 'Viento-madera', clue: 'Timbre redondo y flexible; tiene una lengüeta simple.' },
  { name: 'Viola', img: loadImg('viola'), sample: 'viola', family: 'Cuerdas frotadas', clue: 'Suena más grave y oscuro que el violín; también se toca con arco.' },
  { name: 'Contrabajo', img: loadImg('contrabajo'), sample: 'contrabajo', family: 'Cuerdas frotadas', clue: 'Es el más grande de las cuerdas y sostiene los sonidos más graves.' },
  { name: 'Oboe', img: loadImg('oboe'), sample: 'oboe', family: 'Viento-madera', clue: 'Timbre penetrante y expresivo; usa una doble lengüeta.' },
  { name: 'Fagot', img: loadImg('fagot'), sample: 'fagot', family: 'Viento-madera', clue: 'Tubo largo de sonido grave y cálido; usa doble lengüeta.' },
  { name: 'Trombón', img: loadImg('trombon'), sample: 'trombon', family: 'Viento-metal', clue: 'El tubo se alarga o acorta con una vara deslizante.' },
  { name: 'Bandoneón', img: loadImg('bandoneon'), sample: 'bandoneon', family: 'Viento-fuelle', clue: 'Instrumento de fuelle, esencial en el tango argentino; su sonido nace al abrir y cerrar el aire.' },
];
const ORCHESTRA_INFO_MUSICIANS = [
  { name: 'Violín', character: CHARACTERS[1].img, instrument: INSTRUMENTS[0].img },
  { name: 'Violonchelo', character: MENU_MASCOTS[4], instrument: INSTRUMENTS[4].img },
  { name: 'Flauta', character: loadImg('info-musician-flute'), instrument: INSTRUMENTS[2].img },
  { name: 'Clarinete', character: loadImg('info-musician-clarinet'), instrument: INSTRUMENTS[5].img },
  { name: 'Trompeta', character: MENU_MASCOTS[3], instrument: INSTRUMENTS[1].img },
  { name: 'Percusión', character: MENU_MASCOTS[1], instrument: INSTRUMENTS[3].img },
  { name: 'Viola', character: loadImg('orchestra-viola-musician'), instrument: INSTRUMENTS[6].img },
  { name: 'Contrabajo', character: MENU_MASCOTS[5], instrument: INSTRUMENTS[7].img },
  { name: 'Oboe', character: loadImg('orchestra-oboe-musician'), instrument: INSTRUMENTS[8].img },
  { name: 'Fagot', character: loadImg('orchestra-bassoon-musician'), instrument: INSTRUMENTS[9].img },
  { name: 'Corno', character: loadImg('orchestra-french-horn-musician'), instrument: null },
  { name: 'Trombón', character: loadImg('orchestra-trombone-musician'), instrument: INSTRUMENTS[10].img },
  { name: 'Tuba', character: loadImg('orchestra-tuba-musician'), instrument: null },
  { name: 'Bandoneón', character: loadImg('orchestra-bandoneon-musician'), instrument: INSTRUMENTS[11].img },
];
const INSTRUMENT_GUIDE = {
  'Violín': { history: 'El violín moderno tomó forma en el norte de Italia durante el siglo XVI. Su sonido viajó desde las primeras orquestas barrocas hasta la música actual.', details: 'CUERDAS, de grave a aguda: SOL, RE, LA y MI. El arco, con crines tensadas y resina, frota las cuerdas para hacerlas vibrar. También se puede tocar pizzicato: pellizcá la cuerda con un dedo, sin usar el arco.' },
  'Cello': { history: 'El violonchelo pertenece a la familia del violín y se desarrolló en Italia en el siglo XVI. Se toca sentado, apoyado en una pica que descansa en el suelo.', details: 'CUERDAS, de grave a aguda: DO, SOL, RE y LA. El arco frota las cuerdas para sostener y colorear el sonido. En pizzicato, pulsás la cuerda con un dedo para obtener un sonido corto y definido.' },
  'Viola': { history: 'La viola es una de las voces centrales de la familia de cuerdas frotadas. Comparte la historia de los instrumentos de arco que se consolidaron en Europa en el siglo XVI.', details: 'CUERDAS, de grave a aguda: DO, SOL, RE y LA. El arco pone las cuerdas en vibración al frotarlas; con pizzicato, las pulsás con un dedo. Su registro suele ser más grave que el del violín.' },
  'Contrabajo': { history: 'El contrabajo desciende de grandes instrumentos graves de cuerda europeos del siglo XVI. En la orquesta sostiene el pulso y la base armónica.', details: 'AFINACIÓN habitual de sus cuatro cuerdas, de grave a aguda: MI, LA, RE y SOL. Se toca con arco o pizzicato: el dedo pulsa la cuerda y produce el característico “plum” grave. Es el instrumento más grande de las cuerdas de la orquesta.' },
  'Flauta': { history: 'Las flautas existen desde la antigüedad; la flauta traversa moderna fue perfeccionada en el siglo XIX con un sistema de llaves. Aunque suele ser de metal, pertenece a viento-madera por su manera de producir el sonido.', details: 'No tiene caña. Para hacerla sonar, apoyá el borde del orificio junto al labio inferior y dirigí un hilo de aire hacia el borde opuesto, como al soplar una botella. Cambiá las notas abriendo y cerrando las llaves.' },
  'Clarinete': { history: 'El clarinete se desarrolló en Europa alrededor del siglo XVIII a partir de instrumentos anteriores como el chalumeau. Puede pasar de un registro grave y oscuro a otro brillante.', details: 'Usa CAÑA SIMPLE: una lengüeta de caña se sujeta a la boquilla. Apoyá suavemente el labio inferior en la caña, cerrá los labios alrededor de la boquilla y soplá; los dedos accionan las llaves para cambiar las notas.' },
  'Oboe': { history: 'El oboe moderno evolucionó de instrumentos de doble lengüeta como la chirimía y se consolidó durante el Barroco. Su timbre claro ayuda a afinar a toda la orquesta con la nota LA.', details: 'Usa CAÑA DOBLE: dos láminas de caña vibran una contra otra. Se apoyan los labios alrededor de la caña y se sopla con aire sostenido y controlado. La vibración de las dos láminas produce su sonido penetrante.' },
  'Fagot': { history: 'El fagot evolucionó de instrumentos graves de doble lengüeta del Renacimiento, como el bajón. Su tubo largo se pliega para que el instrumento pueda tocarse cómodamente.', details: 'Usa CAÑA DOBLE, parecida a la del oboe pero montada en un tudel curvo. La caña vibra cuando soplás entre sus dos láminas; las llaves ayudan a tocar sus notas graves y cálidas.' },
  'Trompeta': { history: 'Las trompetas antiguas se usaban en ceremonias y señales. La trompeta con pistones, que permite tocar muchas notas, se desarrolló durante el siglo XIX.', details: 'No usa caña. Apoyá la boquilla en los labios, hacé vibrar los labios con un “brrr” suave y agregá aire constante. Los pistones cambian la longitud del tubo y, junto con los labios, permiten cambiar la nota.' },
  'Trombón': { history: 'El trombón desciende del sacabuche, instrumento de vara muy usado en Europa desde el Renacimiento. Su forma actual conserva la corredera para cambiar la longitud del tubo.', details: 'No usa caña: el sonido nace al hacer vibrar los labios contra la boquilla. Sopla con aire parejo y desliza la vara hacia distintas posiciones para cambiar la altura de las notas.' },
  'Timbal': { history: 'Los timbales orquestales evolucionaron de grandes tambores de caldera usados en Europa desde hace siglos. Se incorporaron a la orquesta y fueron ganando afinación regulable.', details: 'Se toca con dos baquetas o mazas, golpeando el parche con control. Los pedales tensan o aflojan el parche para cambiar la afinación; así puede tocar notas definidas, no solo golpes.' },
  'Bandoneón': { history: 'El bandoneón nació en Alemania en el siglo XIX y llegó al Río de la Plata, donde se volvió una de las voces emblemáticas del tango.', details: 'No usa caña de madera: tiene lengüetas metálicas libres que vibran con el aire. Abrí y cerrá el fuelle mientras accionás los botones; el mismo botón puede dar notas distintas al abrir o cerrar.' },
};
INSTRUMENTS.forEach((instrument) => {
  instrument.audio = new Audio(`assets/audio/sample-${instrument.sample}.mp3`);
  instrument.audio.preload = 'auto';
  instrument.audio.volume = 0.82;
});
const METALLOPHONE = ['c5', 'e5', 'g5', 'c6'].map((note) => {
  const audio = new Audio(`assets/audio/metallofon-${note}.mp3`);
  audio.preload = 'auto';
  audio.volume = 0.78;
  return audio;
});

function playMetalNote(index) {
  if (muted) return;
  const note = METALLOPHONE[index % METALLOPHONE.length];
  const sample = note.cloneNode();
  sample.volume = 0.78;
  sample.play().catch(() => {});
}

function playCorrectJingle() {
  playMetalNote(0);
  window.setTimeout(() => playMetalNote(2), 150);
}

// ---------- Audio ----------
const music = new Audio('assets/audio/musica.mp3');
// Afinador/Metrónomo: silencian la música del menú mientras están abiertos y la retoman al salir.
setMusicToolHooks({
  pauseMusic: () => { music.pause(); },
  resumeMusic: () => { if (!muted && scene === 'menu') music.play().catch(() => {}); },
});
const welcomeMusic = new Audio('assets/audio/bienvenida-orquesta.mp3');
welcomeMusic.preload = 'auto';
welcomeMusic.volume = 0.46;
const DEFAULT_MUSIC = 'assets/audio/musica.mp3';
const CONDUCTOR_TRACKS = {
  2: 'assets/audio/conduccion-2-4-sincronizado.mp3',
  3: 'assets/audio/conduccion-3-4-sincronizado.mp3',
  4: 'assets/audio/conduccion-4-4-sincronizado.mp3',
};
const GAME_MUSIC = {
  menu: DEFAULT_MUSIC,
  dirigir: CONDUCTOR_TRACKS,
  reconocer: 'assets/audio/musica-reconocer.mp3',
  ritmo: 'assets/audio/musica-ritmo.mp3',
  sinfonico: 'assets/audio/musica-sinfonico.mp3',
};
const RHYTHM_MUSIC = {
  facil: 'assets/audio/ritmo-facil-serenata.mp3',
  medio: 'assets/audio/ritmo-medio-pizzicato.mp3',
  dificil: 'assets/audio/ritmo-dificil-epico.mp3',
};
let activeMusicSrc = DEFAULT_MUSIC;
music.loop = true;
music.volume = 0.35;
const sfxClap = new Audio('assets/audio/aplausos.mp3');
const escapeMusic = new Audio('assets/audio/escape-classical-loop.mp3');
escapeMusic.loop = true;
escapeMusic.volume = Math.max(0, Math.min(1, 0.3));
const escapeJumpSound = new Audio('assets/audio/escape-jump-swish.mp3');
const escapeSalieriSound = new Audio('assets/audio/escape-salieri-trick.mp3');
let muted = false;
let actx = null;
let portraitLockRequested = false;

function isCoarsePointerDevice() {
  return !!window.matchMedia?.('(pointer: coarse)').matches;
}

function isMobileLandscape() {
  return isCoarsePointerDevice() && window.innerWidth > window.innerHeight;
}

function isMobilePortrait() {
  return isCoarsePointerDevice() && window.innerHeight >= window.innerWidth;
}

function isSalieriScene() {
  return runnerLayout && (scene === 'salieri-runner' || scene === 'salieri-ranking');
}

function playEscapeEffect(source) {
  if (muted || !source) return;
  const sound = source.cloneNode();
  sound.volume = Math.max(0, Math.min(1, source.volume || 1));
  sound.play().catch(() => {});
}

function startEscapeMusic() {
  if (muted) return;
  escapeMusic.volume = Math.max(0, Math.min(1, 0.3));
  escapeMusic.play().catch(() => {});
}

function unlockAudio() {
  if (!portraitLockRequested && scene !== 'menu' && isCoarsePointerDevice() && window.screen?.orientation?.lock) {
    portraitLockRequested = true;
    try { window.screen.orientation.lock(runnerLayout ? 'landscape' : 'portrait').catch(() => {}); } catch (error) { /* El bloqueo depende del navegador. */ }
  }
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  if (scene === 'intro') startWelcomeAudio();
  const isFocusedListening = scene === 'clase-play' || (scene === 'play' && game?.key === 'sinfonico') || runnerLayout;
  if (!muted && music.paused && !isFocusedListening && scene !== 'intro') {
    music.play().catch(() => {});
  }
}

function playSfx(a) {
  if (muted) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

function playTone(inst, dur = 0.8, playbackRate = 1) {
  if (muted) return;
  const rate = Math.max(0.55, Math.min(1.8, playbackRate));
  if (inst.audio) {
    const sample = inst.audio.cloneNode();
    sample.volume = 0.82;
    sample.playbackRate = rate;
    sample.currentTime = 0;
    sample.play().then(() => {
      if (dur > 0) window.setTimeout(() => sample.pause(), dur * 1000);
    }).catch(() => playSynthFallback(inst, dur, rate));
    return;
  }
  playSynthFallback(inst, dur, rate);
}

function playSynthFallback(inst, dur, rate = 1) {
  if (!actx || muted) return;
  const t = actx.currentTime;
  const gain = actx.createGain();
  gain.connect(actx.destination);
  const osc = actx.createOscillator();
  osc.type = inst.wave || 'triangle';
  osc.frequency.value = (inst.freq || 440) * rate;
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.linearRampToValueAtTime(0.22, t + 0.06);
  gain.gain.setValueAtTime(0.22, t + Math.max(0.08, dur - 0.08));
  gain.gain.linearRampToValueAtTime(0.001, t + dur);
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + dur);
}

const EXAMPLE_NOTE_HZ = [523.25, 659.25, 783.99, 1046.5];
function playExampleClick(accent = false) {
  if (!actx || muted) return;
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  const t = actx.currentTime;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(accent ? 920 : 680, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.075);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(accent ? 0.24 : 0.18, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.105);
  osc.connect(gain);
  gain.connect(actx.destination);
  osc.start(t);
  osc.stop(t + 0.11);
}

function playExampleFrequency(frequency, duration = 0.3) {
  if (!actx || muted) return;
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  const t = actx.currentTime;
  const note = actx.createOscillator();
  const overtone = actx.createOscillator();
  const gain = actx.createGain();
  const overtoneGain = actx.createGain();
  note.type = 'sine';
  note.frequency.setValueAtTime(frequency, t);
  overtone.type = 'sine';
  overtone.frequency.setValueAtTime(frequency * 2, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.2, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  overtoneGain.gain.setValueAtTime(0.0001, t);
  overtoneGain.gain.linearRampToValueAtTime(0.045, t + 0.012);
  overtoneGain.gain.exponentialRampToValueAtTime(0.0001, t + duration * 0.72);
  note.connect(gain);
  overtone.connect(overtoneGain);
  gain.connect(actx.destination);
  overtoneGain.connect(actx.destination);
  note.start(t);
  overtone.start(t);
  note.stop(t + duration + 0.02);
  overtone.stop(t + duration + 0.02);
}

function playExampleNote(index) {
  playExampleFrequency(EXAMPLE_NOTE_HZ[index] || EXAMPLE_NOTE_HZ[0]);
}

// ---------- Online ranking ----------
let db = null;
let ranking = [];
// Último ranking recibido del servidor, guardado para mostrarlo sin conexión (solo datos públicos).
const RANKING_CACHE_KEY = 'oefv-ranking-cache';
let rankingSavedAt = 0;
let rankingLive = false;
try {
  const cached = JSON.parse(storageGet(RANKING_CACHE_KEY) || 'null');
  if (cached && Array.isArray(cached.rows)) {
    ranking = cached.rows.filter((r) => r && typeof r.name === 'string' && Number.isFinite(Number(r.score)));
    rankingSavedAt = Number(cached.savedAt) || 0;
  }
} catch (e) { /* caché dañada: se ignora */ }
let rankingCacheTimer = 0;
function saveRankingCache() {
  clearTimeout(rankingCacheTimer);
  rankingCacheTimer = setTimeout(() => {
    const rows = ranking.map((r) => ({ id: r.id, name: r.name, game: r.game, score: Number(r.score), avatar: r.avatar || 0, timestamp: r.timestamp }));
    try { localStorage.setItem(RANKING_CACHE_KEY, JSON.stringify({ savedAt: rankingSavedAt, rows })); } catch (e) { /* caché opcional */ }
  }, 1500);
}

let rawServerScores = null;
// Solo resultados confirmados: se excluyen los de la cola local que el servidor aún no confirmó
// (InstantDB los muestra de forma optimista antes de guardarlos).
function applyServerRanking() {
  if (!rawServerScores) return;
  ranking = rawServerScores
    .filter((entry) => entry && typeof entry.name === 'string' && !containsProfanity(entry.name) && Number.isFinite(Number(entry.score))
      && !(syncQueue && syncQueue.isUnconfirmed(entry.id)))
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, 300);
  if (syncQueue?.state().reachable) {
    rankingLive = true;
    rankingSavedAt = Date.now();
    saveRankingCache();
  }
}

function initInstantDb() {
  if (!instantDbInit || !INSTANT_DB_APP_ID || db) return;
  try {
    db = instantDbInit({ appId: INSTANT_DB_APP_ID });
    db.subscribeQuery({ scores: {} }, (res) => {
      if (res && res.data && res.data.scores) {
        rawServerScores = res.data.scores;
        applyServerRanking();
      }
    });
    syncQueue?.checkNow();
  } catch (e) {
    db = null;
  }
}

// La librería se carga desde la red (y queda en la caché del service worker). Si no hay conexión,
// el juego sigue offline y se reintenta al recuperar Internet.
let instantDbLoading = false;
function loadInstantDb() {
  if (db || instantDbLoading) return;
  instantDbLoading = true;
  try {
    import('@instantdb/core')
      .then((mod) => {
        if (mod) {
          instantDbInit = mod.init;
          if (mod.id) instantId = mod.id;
          initInstantDb();
        }
      })
      .catch(() => { /* ranking online opcional */ })
      .finally(() => { instantDbLoading = false; });
  } catch (e) {
    instantDbLoading = false;
  }
}
loadInstantDb();
window.addEventListener('online', () => setTimeout(loadInstantDb, 500));
setInterval(() => { if (!db) loadInstantDb(); }, 30000);

// ---------- Cola de sincronización e indicador de conexión ----------
const connectionPill = document.createElement('div');
connectionPill.setAttribute('role', 'status');
connectionPill.setAttribute('aria-live', 'polite');
connectionPill.style.cssText = 'position:fixed;left:50%;top:max(3px,env(safe-area-inset-top));transform:translateX(-50%);z-index:11;display:none;max-width:70vw;padding:2px 8px;border-radius:999px;background:rgba(8,15,38,.72);border:1px solid rgba(147,220,255,.35);color:#e6f7ff;font:700 9px Nunito,sans-serif;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;';
document.body.appendChild(connectionPill);
let connectionToast = '';
let connectionToastUntil = 0;
function connectionToastShow(message) { connectionToast = message; connectionToastUntil = Date.now() + 3800; }
function connectionLabel() {
  if (!syncQueue) return '⚪ OFFLINE';
  const s = syncQueue.state();
  if (s.flushing && s.unsynced) return '🟡 SINCRONIZANDO';
  if (s.reachable && s.error) return `🔴 ERROR · ${s.unsynced} pendiente${s.unsynced === 1 ? '' : 's'}`;
  if (s.reachable) return '🟢 ONLINE';
  return s.unsynced ? `⚪ OFFLINE · ${s.unsynced} por sincronizar` : '⚪ OFFLINE';
}
function updateConnectionPill() {
  const visible = scene === 'menu';
  connectionPill.style.display = visible ? 'block' : 'none';
  if (!visible) return;
  const text = t(Date.now() < connectionToastUntil ? connectionToast : connectionLabel());
  if (connectionPill.textContent !== text) connectionPill.textContent = text;
}
setInterval(() => { try { updateConnectionPill(); } catch (e) { /* escena aún no definida */ } }, 400);

const syncQueue = createSyncQueue({
  getDb: () => db,
  onChange: (s, event) => {
    if (event === 'offline') { rankingLive = false; connectionToastShow('¡Podés seguir jugando sin Internet!'); }
    else if (event === 'online') connectionToastShow(s.unsynced ? '¡Conexión recuperada! Sincronizando tus avances.' : '🟢 ONLINE');
    else if (event === 'sync-start') connectionToastShow('¡Conexión recuperada! Sincronizando tus avances.');
    else if (event === 'sync-done') connectionToastShow('¡Tus puntajes ya están actualizados!');
    else if (event === 'queued' && !s.reachable) connectionToastShow('¡Tus puntajes se guardaron en este dispositivo!');
    if (!s.reachable) rankingLive = false;
    else if (event === 'online' || event === 'sync-done' || event === 'sync-partial' || event === 'state') applyServerRanking();
  },
});
const hasProfile = !!storageGet('oefv-profile');
const PROFANITY_WORDS = new Set([
  'puta', 'puto', 'putas', 'putos', 'putita', 'putito', 'putitas', 'putitos', 'putazo', 'putaza', 'putear', 'puteada', 'puteado',
  'mierda', 'mierdas', 'mierdero', 'mierdera', 'mierdoso', 'mierdosa',
  'pelotudo', 'pelotuda', 'pelotudos', 'pelotudas', 'pelotudez', 'pelotudear',
  'boludo', 'boluda', 'boludos', 'boludas', 'boludez',
  'forro', 'forra', 'forros', 'forras', 'idiota', 'idiotas', 'imbecil', 'imbeciles',
  'estupido', 'estupida', 'estupidos', 'estupidas', 'tarado', 'tarada', 'tarados', 'taradas',
  'gil', 'giles', 'pajero', 'pajera', 'pajeros', 'pajeras', 'carajo', 'carajos',
  'concha', 'conchas', 'conchudo', 'conchuda', 'conchudos', 'conchudas', 'conchita',
  'verga', 'vergas', 'vergudo', 'pija', 'pijas', 'pijo', 'pijos', 'pijudo', 'pito', 'pitos',
  'polla', 'pollas', 'poronga', 'porongas', 'chota', 'chotas', 'choto', 'chotos',
  'culo', 'culos', 'culero', 'culera', 'orto', 'ortos', 'cagon', 'cagona', 'cagones', 'cagonas', 'cagada', 'cagado',
  'coño', 'coños', 'joder', 'jodido', 'jodida', 'jodidos', 'jodidas', 'maricon', 'maricona', 'maricones', 'mogolico', 'mogolica',
  'malparido', 'malparida', 'hijoputa', 'hijodeputa', 'hijadeputa', 'zorra', 'zorras',
  'porno', 'pornografia', 'nudes', 'hentai', 'masturbacion', 'masturbar', 'orgasmo',
  'fuck', 'fucking', 'shit', 'bitch', 'bitches', 'asshole', 'bastard', 'dick', 'dicks', 'cunt', 'motherfucker', 'fucker', 'faggot', 'nigger'
]);
const RESERVED_NAME_PREFIXES = ['admin', 'administrador', 'administrator', 'moderador', 'moderator', 'staff', 'oficial', 'official', 'soporte', 'support', 'orquestaescuela', 'escuela501'];
const BLOCKED_THREAT_PHRASES = ['tevoyamatar', 'tequieromatar', 'voyamatarte', 'ojalaquemueras', 'muerete', 'killyou', 'iwillkill'];
const NAME_SUGGESTIONS = ['NotaFeliz', 'ZorroSol', 'RitmoAzul'];
const CONFUSABLE_LETTERS = { 'а': 'a', 'е': 'e', 'ё': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ї': 'i', 'є': 'e', 'в': 'b', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'ј': 'j', 'α': 'a', 'ο': 'o', 'ρ': 'p', 'ι': 'i', 'κ': 'k', 'τ': 't', 'ν': 'v', 'χ': 'x' };
function normalizeNameWord(value) {
  return String(value).toLowerCase().replace(/ñ/g, '\uE000')
    .replace(/[а-яёіїєвкмнтјαορικτνχ]/g, (char) => CONFUSABLE_LETTERS[char] || char)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\uE000/g, 'ñ')
    .replace(/[01345789@!$]/g, (char) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '!': 'i', '$': 's' })[char] || char)
    .replace(/[^a-z0-9ñ]/g, '').replace(/([a-z0-9ñ])\1+/g, '$1');
}
function containsProfanity(value) {
  const rawValue = String(value || '').trim();
  const digitCount = (rawValue.match(/\d/g) || []).length;
  if (/@|(?:https?:\/\/)|www\./i.test(rawValue)
    || (digitCount >= 7 && /^[+\d\s().-]+$/.test(rawValue))
    || /(?:^|\s)(?:calle|avenida|av\.?|pasaje|ruta|dpto\.?|depto\.?|piso|c[oó]digo postal)(?:\s|$)/i.test(rawValue)) return true;
  const rawWords = rawValue.toLowerCase().split(/\s+/).filter(Boolean);
  const words = rawWords.map(normalizeNameWord).filter(Boolean);
  if (words.some((word) => PROFANITY_WORDS.has(word)
    || BLOCKED_THREAT_PHRASES.some((phrase) => word.startsWith(phrase))
    || RESERVED_NAME_PREFIXES.some((marker) => word.includes(marker)))) return true;
  for (let start = 0; start < words.length; start += 1) {
    let combined = '';
    for (let end = start; end < Math.min(words.length, start + 5); end += 1) {
      combined += words[end];
      if (PROFANITY_WORDS.has(combined) || BLOCKED_THREAT_PHRASES.some((phrase) => combined.startsWith(phrase))
        || RESERVED_NAME_PREFIXES.some((marker) => combined.includes(marker))) return true;
    }
  }
  return false;
}
const storedPlayerName = storageGet('oefv-name');
let playerName = storedPlayerName && !containsProfanity(storedPlayerName)
  ? storedPlayerName
  : 'Alumno' + Math.floor(Math.random() * 900 + 100);
storageSet('oefv-name', playerName);
const profile = readStoredJSON('oefv-profile', { avatar: 0, instrument: 0 }, isPlainObject);
profile.avatar = Math.max(0, Math.min(AVATARS.length - 2, Number(profile.avatar) || 0));
if (profile.composerVersion !== 2) {
  const oldComposerIndex = Number(profile.composer);
  const composerMigration = [0, 1, 0, 0, 0, 2, 3, 4, 5];
  profile.composer = composerMigration[oldComposerIndex] ?? 0;
  profile.composerVersion = 2;
  storageSet('oefv-profile', JSON.stringify(profile));
} else {
  profile.composer = Math.max(0, Math.min(COMPOSERS.length - 1, Number(profile.composer) || 0));
}
let totalPoints = Number(storageGet('oefv-total') || 0);
if (!Number.isFinite(totalPoints) || totalPoints < 0) totalPoints = 0;
function saveProfile() {
  storageSet('oefv-profile', JSON.stringify(profile));
  saveProgressLocally();
}
function openProfile() {
  profileScroll = 0;
  profilePointerDown = null;
  currentNavItem = 2;
  scene = 'profile';
}
function selectProfileOption(group, index) {
  if (group === 'avatar') profile.avatar = index;
  else if (group === 'instrument') {
    profile.instrument = index;
    playTone(INSTRUMENTS[index], 0.8);
  }
  profilePulse = { group, index, ends: time + 0.48 };
  saveProfile();
}
function saveProfileAndReturn() {
  saveProfile();
  storageSet('oefv-name', playerName);
  saveProgressLocally();
  popups.push({ x: W / 2, y: H * 0.42, text: 'PERFIL GUARDADO', color: '#00DFFF', life: 2.1 });
  returnToMenu();
}
function addTotal(points) {
  const before = awardFor(totalPoints);
  totalPoints += Math.max(0, Math.round(points));
  storageSet('oefv-total', String(totalPoints));
  const after = awardFor(totalPoints);
  saveProgressLocally();
  return after !== before ? after : null;
}
const nameModal = document.createElement('div');
nameModal.style.cssText = 'position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:rgba(8,5,25,.78);padding:24px;box-sizing:border-box;';
const namePanel = document.createElement('div');
namePanel.style.cssText = 'width:min(360px,100%);padding:24px;border:2px solid #ffd84a;border-radius:20px;background:#211732;color:#fff;font:600 16px Nunito,sans-serif;text-align:center;box-shadow:0 16px 50px #0008;';
const nameTitle = document.createElement('div');
nameTitle.textContent = 'Elegí un apodo público';
nameTitle.style.cssText = 'font-size:20px;font-weight:800;margin-bottom:16px;color:#ffd84a;';
const nameInput = document.createElement('input');
nameInput.maxLength = 16;
nameInput.autocomplete = 'nickname';
nameInput.placeholder = 'Apodo (no uses tu nombre real)';
nameInput.setAttribute('aria-label', 'Apodo público de perfil');
nameInput.style.cssText = 'width:100%;box-sizing:border-box;padding:13px 14px;border:2px solid #6ee7ff;border-radius:12px;font:600 18px Nunito,sans-serif;';
const nameError = document.createElement('div');
nameError.setAttribute('role', 'alert');
nameError.style.cssText = 'display:none;margin-top:10px;color:#ffb0b0;font:700 13px Nunito,sans-serif;line-height:1.35;';
nameError.textContent = '🎵 ¡Elegí otro nombre! En nuestra orquesta nos respetamos y cuidamos entre todos. Probá con un apodo divertido y amigable.';
const nameSuggestionRow = document.createElement('div');
nameSuggestionRow.style.cssText = 'display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:10px;';
NAME_SUGGESTIONS.forEach((suggestion) => {
  const suggestionButton = document.createElement('button');
  suggestionButton.type = 'button';
  suggestionButton.textContent = suggestion;
  suggestionButton.setAttribute('aria-label', `Usar apodo sugerido ${suggestion}`);
  suggestionButton.style.cssText = 'padding:7px 9px;border:1px solid #57dff4;border-radius:999px;background:#172c50;color:#eafaff;font:700 12px Nunito,sans-serif;';
  suggestionButton.addEventListener('click', () => {
    nameInput.value = suggestion;
    nameError.style.display = 'none';
    nameInput.removeAttribute('aria-invalid');
  });
  nameSuggestionRow.appendChild(suggestionButton);
});
const nameActions = document.createElement('div');
nameActions.style.cssText = 'display:flex;gap:10px;margin-top:16px;';
const nameSave = document.createElement('button');
nameSave.textContent = 'Guardar';
nameSave.style.cssText = 'flex:1;padding:12px;border:0;border-radius:12px;background:#c8323f;color:white;font:800 16px Nunito,sans-serif;';
const nameCancel = document.createElement('button');
nameCancel.textContent = 'Cancelar';
nameCancel.style.cssText = 'flex:1;padding:12px;border:0;border-radius:12px;background:#35456c;color:white;font:800 16px Nunito,sans-serif;';
nameActions.append(nameSave, nameCancel);
namePanel.append(nameTitle, nameInput, nameError, nameSuggestionRow, nameActions);
nameModal.appendChild(namePanel);
container.appendChild(nameModal);
nameModal.addEventListener('pointerdown', (event) => event.stopPropagation());
function savePlayerName() {
  const value = nameInput.value.trim().slice(0, 16);
  if (value && containsProfanity(value)) {
    nameError.style.display = 'block';
    nameInput.setAttribute('aria-invalid', 'true');
    return;
  }
  nameError.style.display = 'none';
  nameInput.removeAttribute('aria-invalid');
  if (value) {
    playerName = value;
    storageSet('oefv-name', playerName);
    saveProgressLocally();
  }
  nameModal.style.display = 'none';
}
nameSave.addEventListener('click', savePlayerName);
nameCancel.addEventListener('click', () => { nameModal.style.display = 'none'; });
nameInput.addEventListener('input', () => {
  nameError.style.display = 'none';
  nameInput.removeAttribute('aria-invalid');
});
nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') savePlayerName();
  if (event.key === 'Escape') nameModal.style.display = 'none';
});
const roomCodeModal = document.createElement('div');
roomCodeModal.style.cssText = 'position:fixed;inset:0;z-index:25;display:none;align-items:center;justify-content:center;background:rgba(8,5,25,.82);padding:24px;box-sizing:border-box;';
const roomCodePanel = document.createElement('div');
roomCodePanel.style.cssText = 'width:min(360px,100%);padding:24px;border:2px solid #4df0ff;border-radius:20px;background:#211732;color:#fff;font:700 16px Nunito, sans-serif;text-align:center;box-shadow:0 16px 50px #0008;';
const roomCodeTitle = document.createElement('div');
roomCodeTitle.textContent = 'Ingresá el código de sala';
roomCodeTitle.style.cssText = 'font-size:20px;font-weight:800;margin-bottom:16px;color:#4df0ff;';
const roomCodeInput = document.createElement('input');
roomCodeInput.maxLength = 8;
roomCodeInput.autocomplete = 'off';
roomCodeInput.placeholder = 'Ej: MUSICA7';
roomCodeInput.style.cssText = 'width:100%;box-sizing:border-box;padding:13px 14px;border:2px solid #ffd84a;border-radius:12px;font:700 20px Nunito,sans-serif;text-transform:uppercase;text-align:center;letter-spacing:3px;';
const roomCodeActions = document.createElement('div');
roomCodeActions.style.cssText = 'display:flex;gap:10px;margin-top:16px;';
const roomCodeJoin = document.createElement('button');
roomCodeJoin.textContent = 'Unirme';
roomCodeJoin.style.cssText = 'flex:1;padding:12px;border:0;border-radius:12px;background:#22a879;color:white;font:800 16px Nunito,sans-serif;';
const roomCodeCancel = document.createElement('button');
roomCodeCancel.textContent = 'Cancelar';
roomCodeCancel.style.cssText = 'flex:1;padding:12px;border:0;border-radius:12px;background:#35456c;color:white;font:800 16px Nunito,sans-serif;';
roomCodeActions.append(roomCodeJoin, roomCodeCancel);
roomCodePanel.append(roomCodeTitle, roomCodeInput, roomCodeActions);
roomCodeModal.appendChild(roomCodePanel);
container.appendChild(roomCodeModal);
roomCodeModal.addEventListener('pointerdown', (event) => event.stopPropagation());
function submitRoomCode() {
  const code = roomCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  roomCodeModal.style.display = 'none';
  if (code.length >= 4) startDuelRoom(code, false);
}
roomCodeJoin.addEventListener('click', submitRoomCode);
roomCodeCancel.addEventListener('click', () => { roomCodeModal.style.display = 'none'; });
roomCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitRoomCode();
  if (event.key === 'Escape') roomCodeModal.style.display = 'none';
});
// Textos de los modales DOM según el idioma elegido (se actualizan al cambiar de idioma).
function applyDomLanguage() {
  nameTitle.textContent = t('Elegí un apodo público');
  nameInput.placeholder = t('Apodo (no uses tu nombre real)');
  nameInput.setAttribute('aria-label', t('Apodo público de perfil'));
  nameError.textContent = t('🎵 ¡Elegí otro nombre! En nuestra orquesta nos respetamos y cuidamos entre todos. Probá con un apodo divertido y amigable.');
  nameSave.textContent = t('Guardar');
  nameCancel.textContent = t('Cancelar');
  roomCodeTitle.textContent = t('Ingresá el código de sala');
  roomCodeInput.placeholder = t('Ej: MUSICA7');
  roomCodeJoin.textContent = t('Unirme');
  roomCodeCancel.textContent = t('Cancelar');
}
applyDomLanguage();
onLangChange(applyDomLanguage);
const best = readStoredJSON('oefv-best', {}, isPlainObject);
// Descarta solo récords individuales inválidos; conserva los válidos.
Object.keys(best).forEach((key) => {
  const value = Number(best[key]);
  if (!Number.isFinite(value) || value < 0) delete best[key];
  else best[key] = value;
});

function submitScore(game, score) {
  if (!best[game] || score > best[game]) {
    best[game] = score;
    storageSet('oefv-best', JSON.stringify(best));
    saveProgressLocally();
  }
  if (containsProfanity(playerName)) return;
  // Cada resultado entra a la cola persistente con un UUID único; se envía cuando el servidor responde.
  syncQueue.enqueue({ playerId: localPlayerId, game, score, name: playerName, avatar: profile.avatar })
    .then(({ saved }) => {
      if (saved) return;
      saveStatusBadge.textContent = '⚠ No se pudo guardar el puntaje para el ranking (almacenamiento lleno o bloqueado)';
      saveStatusBadge.style.opacity = '1';
      window.clearTimeout(saveStatusTimer);
      saveStatusTimer = window.setTimeout(() => { saveStatusBadge.style.opacity = '0'; }, 5000);
    })
    .catch(() => {});
}
let lastNewAward = null;
let lastRankPos = 0;

// ---------- State ----------
const GAMES = [
  { key: 'dirigir', title: 'Dirigir la Orquesta', bg: 'concierto', char: 0, desc: 'Arrastrá la batuta siguiendo el compás' },
  { key: 'ritmo', title: 'Seguir el Ritmo', bg: 'ensayo', char: 1, desc: 'Tocá las notas sobre la línea dorada' },
  { key: 'sinfonico', title: 'Desafío Sinfónico', bg: 'concierto', char: 0, desc: 'Trivia: historia y lenguaje musical' },
  { key: 'rosco', title: 'Rosco Musical', bg: 'concierto', char: 0, desc: 'Un desafío musical para cada letra' },
];
const WELCOME_PREF_KEY = 'oefv-welcome-enabled';
let welcomeEnabled = storageGet(WELCOME_PREF_KEY) !== 'false';
let scene = welcomeEnabled ? 'intro' : (hasProfile ? 'menu' : 'profile');
welcomeLayout = scene === 'intro';
// Recalcula el lienzo ahora que se sabe si arranca la bienvenida (detecta vertical/horizontal desde el primer cuadro).
resize();
let welcomeState = { elapsed: 0, slideElapsed: 0, slide: 0, audioStarted: false };
let currentNavItem = 0;
const FIRST_CONCERT_INVITATION_KEY = 'oefv-first-concert-invitation-seen';
const ORCHESTRA_INVITATION_MESSAGES = [
  '¡Bravo! ¡Tu primer concierto fue increíble!',
  '¿Sabías que también podés vivir esta aventura en una orquesta de verdad?',
  '¡Sumate a los más de 1000 integrantes de nuestra Orquesta Escuela de Florencio Varela!',
  'Si querés aprender a tocar un instrumento, pedile a tu familia que nos escriba por nuestras redes sociales.',
];
let invitationReturnScene = 'menu';
let orchestraInfoReturnScene = 'menu';
let orchestraInfoPage = 'welcome';
let orchestraPromptOpenedForResult = false;
let invitationDialogIndex = 0;
let invitationElapsed = 0;
let invitationPendingUrl = '';
let invitationConfetti = [];
welcomeMusic.loop = true;
resize();
function startWelcomeAudio() {
  if (scene !== 'intro' || muted || welcomeState.audioStarted) return;
  welcomeState.audioStarted = true;
  music.pause();
  welcomeMusic.play().catch(() => { welcomeState.audioStarted = false; });
}
function launchWelcome() {
  welcomeState = { elapsed: 0, slideElapsed: 0, slide: 0, audioStarted: false };
  welcomeLayout = true;
  scene = 'intro';
  music.pause();
  welcomeMusic.pause();
  welcomeMusic.currentTime = 0;
  resize();
  startWelcomeAudio();
}
function leaveIntro() {
  welcomeMusic.pause();
  welcomeMusic.currentTime = 0;
  welcomeLayout = false;
  scene = 'menu';
  currentNavItem = 0;
  setMusicTrack(GAME_MUSIC.menu);
  resize();
}
function openSettings() {
  scene = 'settings';
  welcomeLayout = false;
  resize();
}
function openCredits() {
  creditsLayout = true;
  creditsElapsed = 0;
  creditsClapPlayed = false;
  runnerLayout = false;
  welcomeLayout = false;
  welcomePortraitLayout = false;
  invitationLayout = false;
  orchestraInfoLayout = false;
  orchestraInfoPortraitLayout = false;
  particles = [];
  popups = [];
  music.pause();
  welcomeMusic.pause();
  escapeMusic.pause();
  scene = 'credits';
  resize();
  if (isCoarsePointerDevice() && window.screen?.orientation?.lock) {
    try { window.screen.orientation.lock('landscape').catch(() => {}); } catch (error) { /* La orientación puede quedar libre según el navegador. */ }
  }
}
function skipCredits() {
  creditsElapsed = CREDITS_END;
}
function toggleWelcomePreference() {
  welcomeEnabled = !welcomeEnabled;
  storageSet(WELCOME_PREF_KEY, String(welcomeEnabled));
  saveProgressLocally();
}
let game = null;
let rankingTab = 0;
let st = {};
let score = 0;
let combo = 0;
let time = 0;
let countdownState = null;
let particles = [];
let popups = [];
let buttons = [];
let pointer = { x: 0, y: 0, down: false };
let keyboardConductorHeld = false;
let keyboardFocusIndex = -1;
let keyboardFocusScene = '';
let menuScroll = 0;
let menuMaxScroll = 0;
let menuScrollTop = 0;
let menuNavTop = 0;
let menuPointerDown = null;
let profileScroll = 0;
let profileScrollMax = 0;
let profileScrollTop = 0;
let profileScrollBottom = 0;
let profilePointerDown = null;
let profilePulse = { group: '', index: -1, ends: 0 };
const DIFFICULTIES = {
  facil: { label: 'Fácil', optionCount: 2, lives: 7, rhythmSpeed: 0.58, rhythmSpawn: 1.32, doubleFrom: 99, episodeQuestions: 2, symphonyTempo: 1.16, conductorTempo: 0.82, rhythmHitWindow: 78 },
  medio: { label: 'Medio', optionCount: 3, lives: 5, rhythmSpeed: 0.76, rhythmSpawn: 1.16, doubleFrom: 6, episodeQuestions: 3, symphonyTempo: 1, conductorTempo: 1, rhythmHitWindow: 64 },
  dificil: { label: 'Difícil', optionCount: 4, lives: 2, rhythmSpeed: 1.18, rhythmSpawn: 0.82, doubleFrom: 4, episodeQuestions: 4, symphonyTempo: 0.86, conductorTempo: 1.18, rhythmHitWindow: 38 },
};
const DIFFICULTY_ORDER = ['facil', 'medio', 'dificil'];
const GAME_TITLES = GAMES.map((entry) => entry.title);
let selectedDifficulty = 'facil';
let pendingGameIndex = 0;
let selectedMeter = 2;
let quizGameKey = 'sinfonico';
let selectedQuizTopic = 'historia';
let selectedQuizMode = 'solo';
let selectedQuizDifficulty = 'medio';
const QUIZ_DIFFICULTY_ORDER = ['facil', 'medio', 'dificil'];
const QUIZ_DIFFICULTIES = {
  facil: { label: 'Fácil', questions: 5, timeLimit: 22, lives: null },
  medio: { label: 'Medio', questions: 9, timeLimit: 12, lives: null },
  dificil: { label: 'Difícil', questions: 12, timeLimit: 5, lives: 2 },
};
let duelRoom = null;
let duel = null;
let duelPlayers = [];
let duelError = '';
const PLAYER_ID_KEY = 'oefv-player-id';
function createInternalPlayerId() {
  try {
    if (window.crypto?.randomUUID) return `oefv-${window.crypto.randomUUID()}`;
    if (window.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return `oefv-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    }
  } catch (error) {}
  return `oefv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
const localPlayerId = storageGet(PLAYER_ID_KEY) || (() => {
  const value = createInternalPlayerId();
  storageSet(PLAYER_ID_KEY, value);
  return value;
})();
function saveProgressLocally() {
  try {
    const values = {};
    let previousValues = {};
    try { previousValues = JSON.parse(storageGet(LOCAL_PROGRESS_SNAPSHOT_KEY) || 'null')?.values || {}; } catch (e) { previousValues = {}; }
    const isJson = (text) => { try { JSON.parse(text); return true; } catch (e) { return false; } };
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('oefv-') || key === LOCAL_PROGRESS_SNAPSHOT_KEY || key.endsWith(CORRUPT_BACKUP_SUFFIX)) continue;
      const current = storageGet(key);
      const previous = previousValues[key];
      // Un dato actual dañado no reemplaza una versión válida del respaldo.
      values[key] = (typeof previous === 'string' && !isJson(current) && isJson(previous)) ? previous : current;
    }
    localStorage.setItem(LOCAL_PROGRESS_SNAPSHOT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), values }));
    // Copia adicional en IndexedDB (no reemplaza a localStorage, que sigue siendo la fuente principal).
    kvSet('progress-snapshot', { version: 1, savedAt: Date.now(), values }).catch(() => {});
    if (Date.now() - lastStorageWriteFailureAt < 5000) {
      // Hubo un guardado fallido reciente: no se informa éxito.
      notifyStorageWriteFailure();
      return;
    }
    saveStatusBadge.textContent = '💾 Guardado en este dispositivo · nube de progreso no configurada';
    saveStatusBadge.style.opacity = '1';
    window.clearTimeout(saveStatusTimer);
    saveStatusTimer = window.setTimeout(() => { saveStatusBadge.style.opacity = '0'; }, 2600);
  } catch (error) {
    saveStatusBadge.textContent = '⚠ No se pudo guardar en este dispositivo';
    saveStatusBadge.style.opacity = '1';
    window.clearTimeout(saveStatusTimer);
    saveStatusTimer = window.setTimeout(() => { saveStatusBadge.style.opacity = '0'; }, 5000);
    console.warn('No se pudo guardar el progreso local.', error);
  }
}
window.addEventListener('pagehide', saveProgressLocally);
saveProgressLocally();

const ESCAPE_ACHIEVEMENTS_KEY = 'oefv-salieri-achievements';
const ESCAPE_DOUBLE_JUMP_KEY = 'oefv-salieri-double-jump';
const ESCAPE_LOCAL_SCORES_KEY = 'oefv-salieri-scores';
const ESCAPE_BEST_KEY = 'oefv-salieri-best';
const ESCAPE_SALIERI_ALLY_KEY = 'oefv-salieri-ally';
const ESCAPE_SALIERI_CLEAN_COUNT_KEY = 'oefv-salieri-clean-challenges';
const ESCAPE_SALIERI_FRIENDLY_VISITS_KEY = 'oefv-salieri-friendly-visits';
function readEscapeAchievements() {
  try {
    const saved = JSON.parse(storageGet(ESCAPE_ACHIEVEMENTS_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch (error) { return []; }
}
const salieriRunner = new SalieriEscapeGame({
  avatar: runnerAvatarFor(profile.avatar)[0],
  avatarFallback: runnerAvatarFor(profile.avatar)[1],
  avatarAspectRatio: runnerAvatarFor(profile.avatar)[2],
  backgrounds: ESCAPE_BACKGROUNDS,
  salieri: ESCAPE_SALIERI_CHALLENGER,
  salieriFallback: ESCAPE_SALIERI_FRIENDLY,
  salieriPoses: ESCAPE_SALIERI_POSES,
  obstacleSprites: ESCAPE_OBSTACLE_SPRITES,
  achievements: readEscapeAchievements(),
  doubleJumpUnlocked: storageGet(ESCAPE_DOUBLE_JUMP_KEY) === 'true',
  allyUnlocked: storageGet(ESCAPE_SALIERI_ALLY_KEY) === 'true',
  salieriCleanChallengesTotal: Number(storageGet(ESCAPE_SALIERI_CLEAN_COUNT_KEY) || 0),
  salieriFriendlyVisits: Number(storageGet(ESCAPE_SALIERI_FRIENDLY_VISITS_KEY) || 0),
});
let salieriNewAchievements = [];
const ESCAPE_ACHIEVEMENT_LABELS = {
  'distance-100': 'Primeros 100 metros',
  'survive-60': 'Sobreviviste 60 segundos · ¡doble salto desbloqueado!',
  'dodge-50': 'Esquivaste 50 obstáculos',
  'salieri-3': 'Superaste los tres desafíos de Salieri',
  'mozart-proud': '¡Mozart estaría orgulloso!',
  'new-record': '¡Nuevo récord personal!',
};
function saveEscapeAchievements() {
  storageSet(ESCAPE_ACHIEVEMENTS_KEY, JSON.stringify([...salieriRunner.achievements]));
  storageSet(ESCAPE_DOUBLE_JUMP_KEY, String(salieriRunner.doubleJumpUnlocked));
  storageSet(ESCAPE_SALIERI_ALLY_KEY, String(salieriRunner.allyAchievementUnlocked));
  storageSet(ESCAPE_SALIERI_CLEAN_COUNT_KEY, String(salieriRunner.salieriCleanChallengesTotal));
  storageSet(ESCAPE_SALIERI_FRIENDLY_VISITS_KEY, String(salieriRunner.salieriFriendlyVisits));
  saveProgressLocally();
}
function startSalieriEscape() {
  welcomeLayout = false;
  invitationLayout = false;
  orchestraInfoLayout = false;
  runnerLayout = true;
  scene = 'salieri-runner';
  syncRunnerAvatar(true);
  salieriRunner.reset({
    achievements: readEscapeAchievements(),
    doubleJumpUnlocked: storageGet(ESCAPE_DOUBLE_JUMP_KEY) === 'true',
    allyUnlocked: storageGet(ESCAPE_SALIERI_ALLY_KEY) === 'true',
    salieriCleanChallengesTotal: Number(storageGet(ESCAPE_SALIERI_CLEAN_COUNT_KEY) || 0),
    salieriFriendlyVisits: Number(storageGet(ESCAPE_SALIERI_FRIENDLY_VISITS_KEY) || 0),
  });
  salieriNewAchievements = [];
  popups = [];
  particles = [];
  music.pause();
  welcomeMusic.pause();
  escapeMusic.pause();
  escapeMusic.currentTime = 0;
  escapeMusic.playbackRate = 1;
  resize();
  salieriRunner.update(0, W, H);
  if (!muted) startEscapeMusic();
  if (isCoarsePointerDevice() && window.screen?.orientation?.lock) {
    try { window.screen.orientation.lock('landscape').catch(() => {}); } catch (error) { /* La orientación puede quedar libre según el navegador. */ }
  }
}
function finalizeSalieriRun(event) {
  if (salieriRunner.finalized) return;
  salieriRunner.finalized = true;
  const value = Math.max(0, Math.floor(event.score || salieriRunner.score));
  const oldBest = Number(storageGet(ESCAPE_BEST_KEY) || 0);
  const isRecord = value > oldBest;
  if (isRecord) {
    storageSet(ESCAPE_BEST_KEY, String(value));
    best['escape-salieri'] = value;
    storageSet('oefv-best', JSON.stringify(best));
    salieriRunner.unlockAchievement('new-record');
  }
  let rows = [];
  try {
    const savedRows = JSON.parse(storageGet(ESCAPE_LOCAL_SCORES_KEY) || '[]');
    rows = Array.isArray(savedRows) ? savedRows : [];
  } catch (error) { rows = []; }
  if (!rows.some((row) => row.runId === event.runId)) {
    rows.push({ runId: event.runId, name: playerName, avatar: profile.avatar, score: value, distance: event.distance || 0, notes: event.notes || 0, timestamp: Date.now() });
    rows.sort((a, b) => b.score - a.score);
    storageSet(ESCAPE_LOCAL_SCORES_KEY, JSON.stringify(rows.slice(0, 20)));
  }
  submitScore('escape-salieri', value);
  addTotal(value);
  if (event.won) recordGameWin();
  saveEscapeAchievements();
  escapeMusic.pause();
  if (event.won) playSfx(sfxClap);
}
function handleSalieriRunnerEvents() {
  salieriRunner.drainEvents().forEach((event) => {
    if (event.type === 'jump' || event.type === 'double-jump') playEscapeEffect(escapeJumpSound);
    else if (event.type === 'salieri' || event.type === 'salieri-warning' || event.type === 'salieri-friendly'
      || event.type === 'salieri-friendly-warning' || event.type === 'hit' || event.type === 'trick') playEscapeEffect(escapeSalieriSound);
    else if (event.type === 'collect') playMetalNote(2);
    else if (event.type === 'life-reward') {
      popups.push({ x: W * 0.52, y: H * 0.35, text: '¡BRAVO! +1 VIDA', color: '#ffe45d', life: 1.8 });
      playCorrectJingle();
    } else if (event.type === 'salieri-defeated') {
      storageSet(ESCAPE_SALIERI_CLEAN_COUNT_KEY, String(event.cleanTotal || salieriRunner.salieriCleanChallengesTotal));
      saveProgressLocally();
      popups.push({ x: W * 0.5, y: H * 0.42, text: event.victory || '¡DESAFÍO SUPERADO!', color: '#d9a2ff', life: 2.1 });
      playCorrectJingle();
    } else if (event.type === 'salieri-help') {
      storageSet(ESCAPE_SALIERI_FRIENDLY_VISITS_KEY, String(event.visits || salieriRunner.salieriFriendlyVisits));
      saveProgressLocally();
      const helpText = event.help === 'life' ? '¡SALIERI TE AYUDA! +1 VIDA'
        : event.help === 'notes' ? '¡SALIERI TE AYUDA! +5 NOTAS ♪'
          : event.help === 'shield' ? '¡SALIERI TE AYUDA! ESCUDO MUSICAL'
            : '¡SALIERI TE AYUDA! TEMPO LENTO';
      popups.push({ x: W * 0.5, y: H * 0.42, text: helpText, color: '#ffe45d', life: 2 });
      playCorrectJingle();
    } else if (event.type === 'salieri-ally-unlocked') {
      storageSet(ESCAPE_SALIERI_ALLY_KEY, 'true');
      saveEscapeAchievements();
      escapeMusic.pause();
    } else if (event.type === 'shield-block') {
      popups.push({ x: W * 0.5, y: H * 0.34, text: '¡EL ESCUDO MUSICAL TE PROTEGIÓ!', color: '#7deaff', life: 1.5 });
      playCorrectJingle();
    } else if (event.type === 'ally-dialog-closed') startEscapeMusic();
    else if (event.type === 'pause') escapeMusic.pause();
    else if (event.type === 'resume') startEscapeMusic();
    else if (event.type === 'stage') escapeMusic.playbackRate = Math.max(1, Math.min(1.22, event.playbackRate || 1));
    else if (event.type === 'achievement') {
      if (!salieriNewAchievements.includes(event.id)) salieriNewAchievements.push(event.id);
      if (event.id === 'survive-60') storageSet(ESCAPE_DOUBLE_JUMP_KEY, 'true');
      saveEscapeAchievements();
    } else if (event.type === 'finish') finalizeSalieriRun(event);
  });
}

function setMusicTrack(src) {
  if (activeMusicSrc === src) {
    music.volume = src === GAME_MUSIC.reconocer || src === GAME_MUSIC.sinfonico ? 0.18 : src === GAME_MUSIC.menu ? 0.35 : 0.32;
    if (!muted && music.paused) music.play().catch(() => {});
    return;
  }
  const isConductorTrack = Object.values(CONDUCTOR_TRACKS).includes(src);
  music.playbackRate = isConductorTrack ? music.playbackRate : 1;
  music.volume = src === GAME_MUSIC.reconocer || src === GAME_MUSIC.sinfonico ? 0.18 : src === GAME_MUSIC.menu ? 0.35 : 0.32;
  music.pause();
  music.src = src;
  music.currentTime = 0;
  music.load();
  if (!muted) music.play().catch(() => {});
}

function openDifficultySelect(gameIndex) {
  pendingGameIndex = gameIndex;
  scene = 'difficulty-select';
}

function openMeterSelect() {
  pendingGameIndex = 0;
  scene = 'meter-select';
}

function startCountdown(onComplete, message = '¡Sebastián te desafía!') {
  countdownState = { value: 3, elapsed: 0, message, onComplete };
  music.pause();
  scene = 'countdown';
}

function returnToMenu() {
  countdownState = null;
  runnerLayout = false;
  creditsLayout = false;
  escapeMusic.pause();
  escapeMusic.playbackRate = 1;
  if (isCoarsePointerDevice() && window.screen?.orientation?.lock) {
    try { window.screen.orientation.lock('portrait').catch(() => {}); } catch (error) { /* La orientación puede quedar libre según el navegador. */ }
  }
  currentNavItem = 0;
  duel = null;
  duelRoom = null;
  duelPlayers = [];
  roomCodeModal.style.display = 'none';
  welcomeLayout = false;
  welcomeMusic.pause();
  scene = 'menu';
  setMusicTrack(GAME_MUSIC.menu);
  resize();
}

function startGame(i) {
  if (GAMES[i]?.key === 'sinfonico' || GAMES[i]?.key === 'rosco') {
    openQuizSetup(GAMES[i].key);
    return;
  }
  startCountdown(() => beginGame(i));
}

function beginGame(i) {
  game = GAMES[i];
  scene = 'play';
  score = 0;
  combo = 0;
  time = 0;
  particles = [];
  popups = [];
  st = { t: 0 };
  const difficulty = DIFFICULTIES[selectedDifficulty];
  const musicSource = game.key === 'dirigir' ? GAME_MUSIC.dirigir[selectedMeter] : game.key === 'ritmo' ? RHYTHM_MUSIC[selectedDifficulty] : GAME_MUSIC[game.key];
  setMusicTrack(musicSource);
    if (game.key === 'sinfonico') music.pause();
    music.playbackRate = game.key === 'dirigir' ? difficulty.conductorTempo : 1;
    music.volume = game.key === 'reconocer' || game.key === 'sinfonico' ? 0.18 : 0.32;
    if (game.key === 'dirigir') st.meter = selectedMeter;
  if (game.key === 'dirigir') {
    st.duration = 30;
  } else if (game.key === 'reconocer') {
    st.round = 0;
    nextQuestion();
  } else if (game.key === 'ritmo') {
    st.notes = [];
    st.spawn = 0.8;
    st.duration = Infinity;
    st.lives = 5;
    st.level = 1;
    st.spawned = 0;
  } else {
    st.level = 1;
    st.questionIndex = 0;
    st.lives = DIFFICULTIES[selectedDifficulty].lives;
    st.questionsPerEpisode = DIFFICULTIES[selectedDifficulty].episodeQuestions;
    loadSymphonyQuestion();
  }
}

function endGame() {
  scene = 'result';
  orchestraPromptOpenedForResult = false;
  setMusicTrack(DEFAULT_MUSIC);
  submitScore(game.key, score);
  lastNewAward = addTotal(score);
  const firstSuccessfulConcert = score >= 100 && gamesWon === 0
    && storageGet(FIRST_CONCERT_INVITATION_KEY) !== 'true';
  if (score >= 100) recordGameWin();
  lastRankPos = ranking.filter((r) => r.game === game.key && r.score > score).length + 1;
  playSfx(sfxClap);
  if (firstSuccessfulConcert) openOrchestraInvitation('result', true);
}

function rivalFor(gameKey, pts) {
  const above = ranking.filter((r) => r.game === gameKey && r.score > pts);
  return above.length ? above[above.length - 1] : null;
}

function reward(x, y, pts, text) {
  combo++;
  const gained = pts + Math.min(combo, 10) * 5;
  score += gained;
  popups.push({ x, y, text: text + ' +' + gained, life: 1, color: '#ffd84a' });
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 160;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c: ['#ffd84a', '#ff5a6e', '#6ee7ff'][i % 3] });
  }
}

function miss(x, y, text = '¡Ups!') {
  combo = 0;
  popups.push({ x, y, text, life: 1, color: '#ff7b7b' });
  if (navigator.vibrate) navigator.vibrate(60);
}

// ---------- Challenge logic ----------
function nextQuestion() {
  st.round++;
  if (st.round > 12) {
    endGame();
    return;
  }
  const difficulty = DIFFICULTIES[selectedDifficulty];
  const pool = shuffled(INSTRUMENTS).slice(0, difficulty.optionCount);
  st.options = pool;
  st.answer = pool[Math.floor(Math.random() * pool.length)];
  st.answered = -1;
  st.feedback = '';
  st.qTime = 0;
  setTimeout(() => {
    if (scene === 'play' && game.key === 'reconocer' && st.answered < 0) playTone(st.answer, 1.3);
  }, 400);
}

const SYMPHONY_RHYTHMS = [
  { label: 'TA · TA', beats: 2, hits: [0, 1] },
  { label: 'TA · ti-ti', beats: 2, hits: [0, 1, 1.5] },
  { label: 'ti-ti · TA', beats: 2, hits: [0, 0.5, 1] },
  { label: 'silencio · TA · TA', beats: 2, hits: [0.5, 1] },
];
const SYMPHONY_RHYTHMS_3 = [
  { label: 'TA · TA · TA', beats: 3, hits: [0, 1, 2] },
  { label: 'TA · ti-ti · TA', beats: 3, hits: [0, 1, 1.5, 2] },
  { label: 'ti-ti · silencio · TA', beats: 3, hits: [0, 0.5, 2] },
  { label: 'TA · silencio · ti-ti', beats: 3, hits: [0, 2, 2.5] },
];
const SYMPHONY_MELODIES_3 = [
  { label: '↑ ↑', pitches: [0.72, 1, 1.38] },
  { label: '↑ ↓', pitches: [0.72, 1.38, 0.84] },
  { label: '↓ ↑', pitches: [1.38, 0.72, 1.16] },
  { label: '↓ ↓', pitches: [1.38, 1, 0.72] },
];
const SYMPHONY_MELODIES_4 = [
  { label: '↑ ↑ ↑', pitches: [0.72, 0.84, 1, 1.38] },
  { label: '↓ ↓ ↓', pitches: [1.38, 1, 0.84, 0.72] },
  { label: '↑ ↓ ↑', pitches: [0.72, 1.16, 0.84, 1.38] },
  { label: '↓ ↑ ↓', pitches: [1.38, 0.84, 1.16, 0.72] },
];
const SYMPHONY_STORIES = {
  1: '¡Hola! Soy Sebastián, el zorro director. Empecemos con una marca clara; escuchá el golpe y contá el pulso.',
  2: '¡Muy bien! Ahora alternaré golpes regulares. Prestá atención a cuántos pulsos escuchás.',
  3: 'Llegamos a los ritmos. Yo soy Sebastián, tu director, y voy a tocar patrones con pulsos y sonidos dobles.',
  4: '¡A seguir! Ahora escucharás ritmos en tres tiempos, con subdivisiones y silencios.',
  5: '¡Aventura melódica! Escuchá cómo cambian las notas: cuando el sonido se vuelve más agudo, la melodía sube.',
  6: '¡Gran final musical! Las melodías tienen más notas. Seguí con el oído si suben o bajan.',
  7: 'Última misión: ayudame a ordenar la orquesta. ¿En qué sector se ubica cada instrumento?',
};
const ORCHESTRA_SECTIONS = [
  { key: 'Cuerdas frotadas', label: 'Adelante · izquierda', lesson: 'Las cuerdas suelen ubicarse adelante, a la izquierda.' },
  { key: 'Viento-madera', label: 'Adelante · centro', lesson: 'Las maderas suelen ubicarse adelante, en el centro.' },
  { key: 'Viento-metal', label: 'Atrás · centro', lesson: 'Los metales suelen ubicarse detrás de las maderas.' },
  { key: 'Viento-fuelle', label: 'Adelante · junto a las maderas', lesson: 'El bandoneón es un instrumento de fuelle; su lugar depende de la obra y el arreglo.' },
  { key: 'Percusión', label: 'Al fondo · lateral', lesson: 'La percusión suele ubicarse al fondo, para tener espacio.' },
];

const QUIZ_TOPICS = [
  { key: 'historia', label: 'Historia de la música', icon: '🏛️' },
  { key: 'lenguaje', label: 'Lenguaje musical', icon: '🎼' },
];
const MUSIC_TRIVIA = {
  historia: [
    { prompt: '¿Qué compositor escribió su primera sinfonía cuando tenía alrededor de 8 años?', options: ['Wolfgang Amadeus Mozart', 'Claude Debussy', 'Frédéric Chopin', 'Giuseppe Verdi'], answer: 0, fact: 'Mozart compuso su primera sinfonía, K. 16, siendo niño durante su viaje por Europa.' },
    { prompt: '¿En qué ciudad nació Ludwig van Beethoven?', options: ['Bonn', 'Salzburgo', 'Venecia', 'París'], answer: 0, fact: 'Beethoven nació en Bonn en 1770 y desarrolló gran parte de su carrera en Viena.' },
    { prompt: '¿Qué apodo recibió Antonio Vivaldi por su cabello rojizo?', options: ['El cura rojo', 'El rey del vals', 'El maestro azul', 'El príncipe del piano'], answer: 0, fact: 'Vivaldi fue sacerdote y era conocido como “Il Prete Rosso”, el cura rojo.' },
    { prompt: '¿Qué compositor barroco escribió los Conciertos de Brandeburgo?', options: ['Johann Sebastian Bach', 'Franz Liszt', 'Maurice Ravel', 'Gioachino Rossini'], answer: 0, fact: 'Bach dedicó los seis Conciertos de Brandeburgo al margrave de Brandeburgo en 1721.' },
    { prompt: '¿Quién compuso el ballet El lago de los cisnes?', options: ['Piotr Ilich Chaikovski', 'Joseph Haydn', 'Erik Satie', 'George Gershwin'], answer: 0, fact: 'Chaikovski compuso El lago de los cisnes; su estreno fue en 1877.' },
    { prompt: '¿Qué compositora fue también una virtuosa pianista del siglo XIX?', options: ['Clara Schumann', 'Isabella d’Este', 'Anna Pavlova', 'Marie Curie'], answer: 0, fact: 'Clara Schumann fue una pianista de fama internacional y una compositora destacada.' },
    { prompt: '¿Con qué instrumento se asocia especialmente la música de Frédéric Chopin?', options: ['Piano', 'Trompeta', 'Timbal', 'Fagot'], answer: 0, fact: 'Chopin escribió principalmente para piano y exploró nuevas sonoridades y técnicas.' },
    { prompt: '¿A qué compositor suelen llamar “padre de la sinfonía”?', options: ['Joseph Haydn', 'Igor Stravinski', 'Edvard Grieg', 'Héctor Berlioz'], answer: 0, fact: 'Haydn ayudó a desarrollar la forma de la sinfonía y compuso más de cien.' },
    { prompt: '¿Qué compositor creó la ópera El barbero de Sevilla?', options: ['Gioachino Rossini', 'Giuseppe Verdi', 'Richard Wagner', 'Georges Bizet'], answer: 0, fact: 'La ópera cómica de Rossini se estrenó en 1816 y sigue siendo muy representada.' },
    { prompt: '¿Quién compuso la ópera Carmen?', options: ['Georges Bizet', 'Claude Debussy', 'Felix Mendelssohn', 'Antonio Vivaldi'], answer: 0, fact: 'Bizet compuso Carmen; la habanera es uno de sus momentos más conocidos.' },
    { prompt: '¿Qué compositor francés es famoso por Claro de luna?', options: ['Claude Debussy', 'Gustav Mahler', 'Johann Strauss II', 'Béla Bartók'], answer: 0, fact: 'Claro de luna es el tercer movimiento de la Suite bergamasque de Debussy.' },
    { prompt: '¿Qué compositor escribió El Mesías, que incluye el famoso “Aleluya”?', options: ['George Frideric Handel', 'Johannes Brahms', 'Robert Schumann', 'Sergei Rachmaninoff'], answer: 0, fact: 'Handel compuso El Mesías en 1741; el coro “Aleluya” es uno de sus fragmentos más celebrados.' },
    { prompt: '¿Quién compuso El Danubio azul?', options: ['Johann Strauss II', 'Franz Schubert', 'Edvard Grieg', 'Antonín Dvořák'], answer: 0, fact: 'Johann Strauss hijo, el “rey del vals”, lo estrenó en Viena en 1867.' },
    { prompt: '¿Qué compositor escribió el Boléro?', options: ['Maurice Ravel', 'Erik Satie', 'Camille Saint-Saëns', 'Gabriel Fauré'], answer: 0, fact: 'Ravel compuso el Boléro en 1928: un mismo tema que crece en orquestación.' },
    { prompt: '¿Quién compuso La consagración de la primavera, que causó un escándalo en su estreno?', options: ['Igor Stravinski', 'Sergei Prokofiev', 'Dmitri Shostakóvich', 'Béla Bartók'], answer: 0, fact: 'El estreno de 1913 en París fue tan polémico que el público terminó peleando.' },
    { prompt: '¿Qué compositor escribió la Sinfonía del Nuevo Mundo?', options: ['Antonín Dvořák', 'Gustav Mahler', 'Jean Sibelius', 'Anton Bruckner'], answer: 0, fact: 'Dvořák la compuso en 1893 durante su estadía en Estados Unidos.' },
    { prompt: '¿Qué compositor italiano escribió las óperas Aida y La traviata?', options: ['Giuseppe Verdi', 'Giacomo Puccini', 'Vincenzo Bellini', 'Gaetano Donizetti'], answer: 0, fact: 'Verdi es uno de los compositores de ópera más representados del mundo.' },
    { prompt: '¿Qué compositor escribió Pedro y el lobo para enseñar los instrumentos?', options: ['Sergei Prokofiev', 'Benjamin Britten', 'Camille Saint-Saëns', 'Leonard Bernstein'], answer: 0, fact: 'En Pedro y el lobo (1936) cada personaje es un instrumento.' },
    { prompt: '¿Quién compuso El carnaval de los animales?', options: ['Camille Saint-Saëns', 'Claude Debussy', 'Hector Berlioz', 'Georges Bizet'], answer: 0, fact: 'Saint-Saëns retrató animales con instrumentos; “El cisne” es para violonchelo.' },
    { prompt: '¿Qué compositor argentino escribió el Malambo de Estancia?', options: ['Alberto Ginastera', 'Ariel Ramírez', 'Carlos Guastavino', 'Mariano Mores'], answer: 0, fact: 'Ginastera es uno de los grandes compositores académicos argentinos.' },
    { prompt: '¿Qué compositor argentino creó la Misa Criolla?', options: ['Ariel Ramírez', 'Astor Piazzolla', 'Alberto Ginastera', 'Atahualpa Yupanqui'], answer: 0, fact: 'Ariel Ramírez compuso la Misa Criolla en 1964 con ritmos folclóricos.' },
    { prompt: '¿En qué período musical se ubica Beethoven entre el Clasicismo y…?', options: ['El Romanticismo', 'El Barroco', 'El Renacimiento', 'El Minimalismo'], answer: 0, fact: 'Beethoven es el puente entre el Clasicismo y el Romanticismo.' },
    { prompt: '¿Qué instrumento tocaba Niccolò Paganini como virtuoso?', options: ['Violín', 'Piano', 'Flauta', 'Arpa'], answer: 0, fact: 'Paganini fue tan virtuoso con el violín que se decían leyendas sobre él.' },
    { prompt: '¿Qué compositor escribió El Cascanueces?', options: ['Piotr Ilich Chaikovski', 'Igor Stravinski', 'Nikolái Rimski-Kórsakov', 'Modest Músorgski'], answer: 0, fact: 'El Cascanueces se estrenó en 1892 y es un clásico de cada Navidad.' },
    { prompt: '¿Qué compositor escribió la ópera La flauta mágica?', options: ['Wolfgang Amadeus Mozart', 'Joseph Haydn', 'Christoph Gluck', 'Carl Maria von Weber'], answer: 0, fact: 'La flauta mágica (1791) incluye el famoso aria de la Reina de la Noche.' },
    { prompt: '¿En qué período vivieron Vivaldi, Bach y Handel?', options: ['Barroco', 'Romanticismo', 'Clasicismo', 'Impresionismo'], answer: 0, fact: 'El Barroco va aproximadamente de 1600 a 1750.' },
    { prompt: '¿Qué compositor quedó sordo y aun así compuso la Novena sinfonía?', options: ['Ludwig van Beethoven', 'Franz Schubert', 'Robert Schumann', 'Johannes Brahms'], answer: 0, fact: 'En el estreno de la Novena, Beethoven tuvo que girarse para ver los aplausos.' },
    { prompt: '¿Qué compositor escribió la banda sonora de Star Wars?', options: ['John Williams', 'Hans Zimmer', 'Ennio Morricone', 'Howard Shore'], answer: 0, fact: 'John Williams compuso Star Wars, Harry Potter, Jurassic Park y más.' },
    { prompt: '¿Qué compositor argentino escribió música de películas como Brokeback Mountain?', options: ['Gustavo Santaolalla', 'Lalo Schifrin', 'Astor Piazzolla', 'Fito Páez'], answer: 0, fact: 'Santaolalla ganó dos premios Oscar consecutivos a mejor banda sonora.' },
  ],
  lenguaje: [
    { prompt: 'En un compás simple de 4/4, ¿cuántos pulsos suele durar una negra?', options: ['Un pulso', 'Dos pulsos', 'Medio pulso', 'Cuatro pulsos'], answer: 0, fact: 'En 4/4, la negra es la unidad de pulso: dos corcheas ocupan el mismo tiempo.' },
    { prompt: '¿Qué indica crescendo?', options: ['Aumentar gradualmente el volumen', 'Tocar cada vez más lento', 'Repetir desde el comienzo', 'Acortar las notas'], answer: 0, fact: 'Crescendo significa crecer en intensidad poco a poco.' },
    { prompt: '¿Cómo se toca una nota staccato?', options: ['Corta y separada', 'Muy larga y ligada', 'Siempre muy fuerte', 'Sin pulso'], answer: 0, fact: 'Staccato pide separar y acortar las notas, con pequeños espacios entre ellas.' },
    { prompt: '¿Qué indica una fermata sobre una nota?', options: ['Sostenerla más de lo habitual', 'Tocarla muy corta', 'Subir una octava', 'Repetirla dos veces'], answer: 0, fact: 'La fermata prolonga una nota o un silencio según el criterio musical.' },
    { prompt: '¿Qué sensación suele asociarse al compás de 3/4?', options: ['Un balanceo de vals', 'Una marcha en cinco', 'Un pulso sin acentos', 'Un silencio continuo'], answer: 0, fact: 'El 3/4 agrupa tres pulsos y aparece en muchísimos valses.' },
    { prompt: '¿Qué función tiene la clave de sol?', options: ['Ubica la nota sol en el pentagrama', 'Indica el volumen', 'Marca el final de la obra', 'Señala una pausa'], answer: 0, fact: 'La clave fija la altura de las notas; la clave de sol coloca el sol en la segunda línea.' },
    { prompt: '¿Qué significa forte (f)?', options: ['Fuerte', 'Suave', 'Rápido', 'Ligado'], answer: 0, fact: 'Forte indica tocar con intensidad fuerte; piano (p) indica suave.' },
    { prompt: '¿Qué quiere decir allegro?', options: ['Rápido y animado', 'Muy lento', 'En silencio', 'Con notas cortadas'], answer: 0, fact: 'Allegro es una indicación de tempo rápido y carácter animado.' },
    { prompt: '¿Qué representa una figura de silencio?', options: ['Un tiempo sin sonido que también se cuenta', 'Una nota que se toca muy fuerte', 'Un cambio de instrumento', 'El final de la partitura'], answer: 0, fact: 'Los silencios tienen duración exacta: se cuentan igual que las figuras sonoras.' },
    { prompt: '¿Qué es un semitono?', options: ['La distancia más pequeña habitual entre dos notas vecinas', 'Una frase de ocho compases', 'Un tipo de arco', 'Un silencio de medio compás'], answer: 0, fact: 'En el piano, un semitono separa dos teclas contiguas, blancas o negras.' },
    { prompt: '¿Qué hace una ligadura de unión entre dos notas iguales?', options: ['Suma sus duraciones en un solo sonido', 'Las convierte en notas picadas', 'Cambia la tonalidad', 'Indica que hay que repetir'], answer: 0, fact: 'La ligadura une dos notas de la misma altura para sostener el sonido.' },
    { prompt: '¿Qué marca el director con sus gestos?', options: ['El pulso y las entradas musicales', 'El nombre de cada nota', 'La afinación de cada cuerda', 'El número de página'], answer: 0, fact: 'La dirección coordina el pulso, los cambios de carácter y las entradas de la orquesta.' },
    { prompt: '¿Qué significa adagio?', options: ['Lento', 'Muy rápido', 'Fuerte', 'Picado'], answer: 0, fact: 'Adagio es un tempo lento y tranquilo.' },
    { prompt: '¿Qué indica diminuendo?', options: ['Bajar el volumen poco a poco', 'Acelerar', 'Subir una octava', 'Tocar pizzicato'], answer: 0, fact: 'Diminuendo (o decrescendo) es lo contrario del crescendo.' },
    { prompt: '¿Qué es pizzicato en las cuerdas?', options: ['Pellizcar la cuerda con el dedo', 'Tocar con el arco muy rápido', 'Golpear la madera', 'Tocar sin afinar'], answer: 0, fact: 'En pizzicato se deja el arco y se pulsa la cuerda con el dedo.' },
    { prompt: '¿Qué indica el becuadro (♮)?', options: ['Anula un sostenido o bemol', 'Repite el compás', 'Sube una octava', 'Marca un silencio'], answer: 0, fact: 'El becuadro devuelve la nota a su altura natural.' },
    { prompt: '¿Cuántas corcheas entran en una blanca?', options: ['4', '2', '8', '1'], answer: 0, fact: 'Blanca = 2 negras = 4 corcheas.' },
    { prompt: '¿Qué es una escala mayor?', options: ['Una serie de 7 notas con tonos y semitonos en orden fijo', 'Un acorde de 3 notas', 'Un compás largo', 'Un tipo de silencio'], answer: 0, fact: 'La escala mayor sigue el patrón T-T-S-T-T-T-S.' },
    { prompt: '¿Qué es un acorde?', options: ['Tres o más notas que suenan juntas', 'Una nota muy larga', 'Una cuerda del violín', 'Un tipo de compás'], answer: 0, fact: 'El acorde más básico, la tríada, tiene tres notas superpuestas por terceras.' },
    { prompt: '¿Qué es una octava?', options: ['La misma nota más aguda o más grave', 'Ocho compases seguidos', 'Una nota con puntillo', 'Un instrumento de viento'], answer: 0, fact: 'Entre una nota y su octava, la frecuencia se duplica.' },
    { prompt: '¿Qué hace el puntillo al lado de una nota?', options: ['Le suma la mitad de su duración', 'La acorta a la mitad', 'La vuelve staccato', 'La sube un semitono'], answer: 0, fact: 'Una negra con puntillo dura un pulso y medio.' },
    { prompt: '¿Qué es el tempo?', options: ['La velocidad de la música', 'El volumen', 'El timbre', 'La altura de la nota'], answer: 0, fact: 'El tempo se mide en pulsos por minuto (BPM).' },
    { prompt: '¿Qué significa legato?', options: ['Notas unidas, sin cortes', 'Notas cortas', 'Muy fuerte', 'Muy rápido'], answer: 0, fact: 'Legato pide que las notas se enlacen suavemente.' },
    { prompt: '¿Qué es el timbre?', options: ['El “color” que distingue a cada instrumento', 'La velocidad', 'El número de notas', 'La duración'], answer: 0, fact: 'Por el timbre distinguimos un violín de una flauta tocando la misma nota.' },
    { prompt: '¿Qué indica el signo de repetición :||?', options: ['Volver a tocar un fragmento', 'Terminar la obra', 'Hacer silencio', 'Cambiar de clave'], answer: 0, fact: 'Las barras de repetición encierran el fragmento que se repite.' },
    { prompt: '¿En qué clave leen el violonchelo y el contrabajo?', options: ['Clave de fa', 'Clave de sol', 'Sin clave', 'Clave de percusión'], answer: 0, fact: 'La clave de fa en cuarta línea se usa para instrumentos graves.' },
    { prompt: '¿Qué es un tresillo?', options: ['Tres notas en el tiempo de dos', 'Tres compases', 'Tres instrumentos juntos', 'Un acorde de tres notas'], answer: 0, fact: 'El tresillo se marca con un 3 sobre el grupo de notas.' },
    { prompt: '¿Qué significa fortissimo (ff)?', options: ['Muy fuerte', 'Muy suave', 'Muy lento', 'Muy corto'], answer: 0, fact: 'ff es más fuerte que f; pp es pianissimo, muy suave.' },
    { prompt: '¿Qué es la armadura de clave?', options: ['Los sostenidos o bemoles al inicio del pentagrama', 'El atril del músico', 'El estuche del instrumento', 'La última nota'], answer: 0, fact: 'La armadura indica qué notas se alteran durante toda la obra.' },
  ],
};
const ROSCO_QUESTIONS = [
  // --- LETRA A ---
  { letter: 'A', prompt: 'Compositor italiano barroco de Las cuatro estaciones.', options: ['Antonio Vivaldi', 'Ludwig van Beethoven', 'Frédéric Chopin', 'Maurice Ravel'], answer: 0 },
  { letter: 'A', prompt: 'Indicación de tempo que significa rápido y animado.', options: ['Allegro', 'Adagio', 'Andante', 'Lento'], answer: 0 },
  { letter: 'A', prompt: 'Instrumento de cuerdas pulsadas con marco triangular y pedales.', options: ['Arpa', 'Oboe', 'Fagot', 'Tuba'], answer: 0 },
  { letter: 'A', prompt: 'Varilla con crines de caballo usada para frotar las cuerdas del violín.', options: ['Arco', 'Atril', 'Anillo', 'Agudo'], answer: 0 },
  { letter: 'A', prompt: 'Soporte donde los músicos de la orquesta apoyan sus partituras.', options: ['Atril', 'Armario', 'Asiento', 'Arpegio'], answer: 0 },
  { letter: 'A', prompt: 'Sucesión de las notas de un acorde tocadas una tras otra.', options: ['Arpegio', 'Acento', 'Atonal', 'Aria'], answer: 0 },

  // --- LETRA B ---
  { letter: 'B', prompt: 'Instrumento de fuelle protagonista fundamental del tango argentino.', options: ['Bandoneón', 'Flauta', 'Timbal', 'Viola'], answer: 0 },
  { letter: 'B', prompt: 'Compositor alemán de la Novena sinfonía y la Oda a la alegría.', options: ['Beethoven', 'Brahms', 'Bach', 'Berlioz'], answer: 0 },
  { letter: 'B', prompt: 'Alteración musical que baja el sonido de una nota un semitono.', options: ['Bemol', 'Sostenido', 'Becuadro', 'Puntillo'], answer: 0 },
  { letter: 'B', prompt: 'Varilla fina y ligera que usa el director para guiar a la orquesta.', options: ['Batuta', 'Baqueta', 'Boquilla', 'Bisel'], answer: 0 },
  { letter: 'B', prompt: 'Palillos o mazas con los que se percute el tambor, xilófono o timbal.', options: ['Baquetas', 'Botones', 'Batutas', 'Baras'], answer: 0 },
  { letter: 'B', prompt: 'Compositor alemán barroco creador de los Conciertos de Brandeburgo.', options: ['Bach', 'Brahms', 'Bartók', 'Bizet'], answer: 0 },

  // --- LETRA C ---
  { letter: 'C', prompt: 'Instrumento de viento-madera con lengüeta simple y registro amplio.', options: ['Clarinete', 'Trombón', 'Arpa', 'Contrabajo'], answer: 0 },
  { letter: 'C', prompt: 'Compositor polaco romántico famoso por sus nocturnos y valses para piano.', options: ['Chopin', 'Chaikovski', 'Corelli', 'Copland'], answer: 0 },
  { letter: 'C', prompt: 'Unidad de tiempo que agrupa los pulsos y se separa con líneas divisorias.', options: ['Compás', 'Clave', 'Coda', 'Calderón'], answer: 0 },
  { letter: 'C', prompt: 'Instrumento de cuerda frotada más grande y grave de toda la orquesta.', options: ['Contrabajo', 'Cello', 'Clarinete', 'Corno'], answer: 0 },
  { letter: 'C', prompt: 'Aumento gradual del volumen o intensidad de la música.', options: ['Crescendo', 'Calderón', 'Coda', 'Cadencia'], answer: 0 },
  { letter: 'C', prompt: 'Signo que corona una nota prolongando su duración a gusto del director.', options: ['Calderón', 'Clave', 'Compás', 'Cromático'], answer: 0 },

  // --- LETRA D ---
  { letter: 'D', prompt: 'Nota musical que en el sistema de solfeo latino se llama do.', options: ['Do', 'Fa', 'La', 'Si'], answer: 0 },
  { letter: 'D', prompt: 'Persona que guía a la orquesta marcando el compás y las entradas.', options: ['Director', 'Solista', 'Afinador', 'Copista'], answer: 0 },
  { letter: 'D', prompt: 'Compositor impresionista francés de Claro de luna y El mar.', options: ['Debussy', 'Delibes', 'Dukas', 'Dvořák'], answer: 0 },
  { letter: 'D', prompt: 'Disminución progresiva del volumen sonoro en la partitura.', options: ['Diminuendo', 'Da Capo', 'Dúo', 'Disonancia'], answer: 0 },
  { letter: 'D', prompt: 'Horquilla metálica en U que al golpearse vibra en la nota LA 440 Hz.', options: ['Diapasón', 'Dinamómetro', 'Director', 'Doble'], answer: 0 },
  { letter: 'D', prompt: 'Agrupación o pieza musical escrita para dos intérpretes.', options: ['Dúo', 'Doble', 'Divisi', 'Deceto'], answer: 0 },

  // --- LETRA E ---
  { letter: 'E', prompt: 'Indicación italiana que pide interpretar con energía y vigor.', options: ['Energico', 'Largo', 'Piano', 'Adagio'], answer: 0 },
  { letter: 'E', prompt: 'Sucesión ordenada de notas, como do-re-mi-fa-sol-la-si.', options: ['Escala', 'Acorde', 'Ritmo', 'Pulso'], answer: 0 },
  { letter: 'E', prompt: 'Espacio físico donde los músicos se presentan ante el público.', options: ['Escenario', 'Atril', 'Foso', 'Camarín'], answer: 0 },
  { letter: 'E', prompt: 'Sesión de práctica de la orquesta para preparar las obras.', options: ['Ensayo', 'Estreno', 'Exposición', 'Entrada'], answer: 0 },
  { letter: 'E', prompt: 'Ballet argentino con danzas pampeanas compuesto por Alberto Ginastera.', options: ['Estancia', 'El ceibo', 'Evocación', 'España'], answer: 0 },

  // --- LETRA F ---
  { letter: 'F', prompt: 'Instrumento de viento que se toca transversalmente y suena brillante y ágil.', options: ['Flauta', 'Timbal', 'Oboe', 'Trompeta'], answer: 0 },
  { letter: 'F', prompt: 'Instrumento grave de viento-madera con un tubo largo doblado y doble lengüeta.', options: ['Fagot', 'Flauta', 'Fliscorno', 'Flautín'], answer: 0 },
  { letter: 'F', prompt: 'Indicación de matiz dinámico que ordena tocar fuerte.', options: ['Forte', 'Piano', 'Fine', 'Fermata'], answer: 0 },
  { letter: 'F', prompt: 'Compositora y pianista virtuosa hermana de Felix Mendelssohn.', options: ['Fanny Mendelssohn', 'Flora', 'Franca', 'Frida'], answer: 0 },
  { letter: 'F', prompt: 'Forma musical polifónica donde un tema principal se imita en distintas voces.', options: ['Fuga', 'Fanfarria', 'Fantasía', 'Festín'], answer: 0 },

  // --- LETRA G ---
  { letter: 'G', prompt: 'Nota que la clave de sol ubica en la segunda línea del pentagrama.', options: ['Sol', 'Fa', 'La', 'Si'], answer: 0 },
  { letter: 'G', prompt: 'Cantante y compositor inmortal del tango, el Zorzal criollo.', options: ['Carlos Gardel', 'Roberto Goyeneche', 'León Gieco', 'Charly García'], answer: 0 },
  { letter: 'G', prompt: 'Gran compositor argentino de música académica y del ballet Estancia.', options: ['Alberto Ginastera', 'Carlos Guastavino', 'George Gershwin', 'Mijaíl Glinka'], answer: 0 },
  { letter: 'G', prompt: 'Disco de bronce percutido que produce un sonido solemne y expansivo.', options: ['Gong', 'Güiro', 'Guitarra', 'Gaita'], answer: 0 },
  { letter: 'G', prompt: 'Instrumento de percusión de láminas metálicas de sonido brillante y cristalino.', options: ['Glockenspiel', 'Guitarra', 'Gong', 'Gaita'], answer: 0 },

  // --- LETRA H ---
  { letter: 'H', prompt: 'Compositor austríaco clásico conocido como el padre de la sinfonía.', options: ['Joseph Haydn', 'Johann Strauss', 'Hector Berlioz', 'Sergei Prokofiev'], answer: 0 },
  { letter: 'H', prompt: 'Compositor del período barroco creador del célebre oratorio El Mesías.', options: ['Georg Friedrich Händel', 'Joseph Haydn', 'Gustav Holst', 'Paul Hindemith'], answer: 0 },
  { letter: 'H', prompt: 'Composición musical patriótica y solemne que identifica a una nación.', options: ['Himno', 'Habanera', 'Huayno', 'Hertz'], answer: 0 },
  { letter: 'H', prompt: 'Compositor británico de la célebre suite Los planetas.', options: ['Gustav Holst', 'Hans Zimmer', 'Paul Hindemith', 'Engelbert Humperdinck'], answer: 0 },
  { letter: 'H', prompt: 'Unidad con la que se mide la frecuencia y altura de una onda sonora.', options: ['Hertz', 'Hectopascal', 'Hora', 'Halógeno'], answer: 0 },

  // --- LETRA I ---
  { letter: 'I', prompt: 'Procedimiento donde una voz o instrumento repite el motivo tocado por otro.', options: ['Imitación', 'Improvisación', 'Intervalo', 'Intensidad'], answer: 0 },
  { letter: 'I', prompt: 'Distancia o diferencia de altura entre dos notas musicales.', options: ['Intervalo', 'Intensidad', 'Introducción', 'Interludio'], answer: 0 },
  { letter: 'I', prompt: 'Grado de fuerza, volumen o potencia con que se emite un sonido.', options: ['Intensidad', 'Imitación', 'Intervalo', 'Inversión'], answer: 0 },
  { letter: 'I', prompt: 'Arte de crear y tocar música en el mismo instante en que se ejecuta.', options: ['Improvisación', 'Interpretación', 'Imitación', 'Instrumentación'], answer: 0 },
  { letter: 'I', prompt: 'Sección musical inicial que precede al tema principal de una canción.', options: ['Introducción', 'Interludio', 'Imitación', 'Índice'], answer: 0 },

  // --- LETRA J ---
  { letter: 'J', prompt: 'Nombre de pila del gran maestro barroco Bach: ___ Sebastian Bach.', options: ['Johann', 'Joseph', 'Jules', 'Jean'], answer: 0 },
  { letter: 'J', prompt: 'Género musical afroamericano nacido en Nueva Orleans famoso por el swing y la improvisación.', options: ['Jazz', 'Jota', 'Joropo', 'Jingle'], answer: 0 },
  { letter: 'J', prompt: 'Danza tradicional española alegre y saltada en compás ternario.', options: ['Jota', 'Joropo', 'Jarabe', 'Jig'], answer: 0 },
  { letter: 'J', prompt: 'Música breve y pegadiza compuesta para publicidades y marcas.', options: ['Jingle', 'Jazz', 'Joropo', 'Jota'], answer: 0 },
  { letter: 'J', prompt: 'Nombre de pila del compositor del vals El Danubio azul: ___ Strauss.', options: ['Johann', 'Julius', 'Jacob', 'Justin'], answer: 0 },

  // --- LETRA K ---
  { letter: 'K', prompt: 'Primera sección coral de la misa cuyo texto significa “Señor, ten piedad”.', options: ['Kyrie', 'Koto', 'Klezmer', 'Kundiman'], answer: 0 },
  { letter: 'K', prompt: 'Letra con la que Ludwig von Köchel catalogó todas las obras de Mozart.', options: ['K', 'M', 'BWV', 'Op'], answer: 0 },
  { letter: 'K', prompt: 'Instrumento tradicional japonés de cuerdas pulsadas sobre puentes móviles.', options: ['Koto', 'Kazoo', 'Kalimba', 'Kora'], answer: 0 },
  { letter: 'K', prompt: 'Pequeño tubo con membrana que modifica la voz al tararear sobre él.', options: ['Kazoo', 'Koto', 'Kalimba', 'Kora'], answer: 0 },
  { letter: 'K', prompt: 'Instrumento africano con lengüetas metálicas que se pulsan con los pulgares.', options: ['Kalimba', 'Koto', 'Kazoo', 'Kora'], answer: 0 },

  // --- LETRA L ---
  { letter: 'L', prompt: 'Nombre de pila de Ludwig van Beethoven.', options: ['Ludwig', 'Leonard', 'Lorenzo', 'Louis'], answer: 0 },
  { letter: 'L', prompt: 'Indicación de articular los sonidos de forma unida, fluida y sin cortes.', options: ['Legato', 'Lento', 'Largo', 'Loco'], answer: 0 },
  { letter: 'L', prompt: 'Nota musical de 440 Hz que da el oboe para afinar a toda la orquesta.', options: ['La', 'Do', 'Mi', 'Sol'], answer: 0 },
  { letter: 'L', prompt: 'Línea curva en la partitura que une notas para ligar su articulación o duración.', options: ['Ligadura', 'Línea', 'Límite', 'Lápiz'], answer: 0 },
  { letter: 'L', prompt: 'Tempo musical muy lento, amplio y solemne.', options: ['Largo', 'Lento', 'Legato', 'Loco'], answer: 0 },

  // --- LETRA M ---
  { letter: 'M', prompt: 'Apellido del genial compositor austríaco Wolfgang Amadeus.', options: ['Mozart', 'Mahler', 'Mendelssohn', 'Monteverdi'], answer: 0 },
  { letter: 'M', prompt: 'Sucesión de notas con sentido musical que solemos cantar o recordar.', options: ['Melodía', 'Métrica', 'Matiz', 'Modulación'], answer: 0 },
  { letter: 'M', prompt: 'Aparato que marca el pulso regular con un tic sonoro o visual.', options: ['Metrónomo', 'Micrófono', 'Monitor', 'Megáfono'], answer: 0 },
  { letter: 'M', prompt: 'Instrumento de percusión con láminas de madera y tubos resonadores debajo.', options: ['Marimba', 'Metalófono', 'Mandolina', 'Melódica'], answer: 0 },
  { letter: 'M', prompt: 'Género musical rioplatense alegre y sincopado emparentado con el tango.', options: ['Milonga', 'Mazurca', 'Minué', 'Madrigal'], answer: 0 },

  // --- LETRA N ---
  { letter: 'N', prompt: 'Signo gráfico que representa la altura y duración de un sonido musical.', options: ['Nota', 'Neuma', 'Núcleo', 'Nivel'], answer: 0 },
  { letter: 'N', prompt: 'Figura musical que equivale a un pulso en compás de cuatro cuartos.', options: ['Negra', 'Blanca', 'Redonda', 'Corchea'], answer: 0 },
  { letter: 'N', prompt: 'Pieza para piano de carácter poético, lírico y nocturno, típica de Chopin.', options: ['Nocturno', 'Noneto', 'Novena', 'Neuma'], answer: 0 },
  { letter: 'N', prompt: 'Sistema de signos y reglas para escribir y leer música.', options: ['Notación', 'Núcleo', 'Neuma', 'Nivel'], answer: 0 },
  { letter: 'N', prompt: 'Agrupación o conjunto formado por nueve instrumentistas.', options: ['Noneto', 'Novena', 'Nódulo', 'Neto'], answer: 0 },

  // --- LETRA Ñ ---
  { letter: 'Ñ', prompt: 'Contiene Ñ: símbolo con dos barras y dos puntos que indica volver a tocar un fragmento.', options: ['Señal de repetición', 'Clave de sol', 'Silencio', 'Compás'], answer: 0 },
  { letter: 'Ñ', prompt: 'Contiene Ñ: lugar o encuentro tradicional donde se canta y baila folclore.', options: ['Peña', 'Milonga', 'Ópera', 'Teatro'], answer: 0 },
  { letter: 'Ñ', prompt: 'Contiene Ñ: gesto sutil con la mirada o la mano que hace el director para dar una entrada.', options: ['Seña', 'Solo', 'Coda', 'Tutti'], answer: 0 },
  { letter: 'Ñ', prompt: 'Contiene Ñ: instrumento autóctono de viento mapuche hecho de caña coligüe larga.', options: ['Ñolkin o Trutruca', 'Charango', 'Bombo', 'Siku'], answer: 0 },
  { letter: 'Ñ', prompt: 'Contiene Ñ: emoción tierna de recuerdo y cariño que despierta una vieja melodía.', options: ['Añoranza o Nostalgia', 'Enojo', 'Prisa', 'Miedo'], answer: 0 },

  // --- LETRA O ---
  { letter: 'O', prompt: 'Instrumento de viento-madera de doble lengüeta con timbre dulce y penetrante.', options: ['Oboe', 'Arpa', 'Tuba', 'Viola'], answer: 0 },
  { letter: 'O', prompt: 'Género teatral escénico donde toda la obra se canta con orquesta.', options: ['Ópera', 'Obertura', 'Oratorio', 'Opereta'], answer: 0 },
  { letter: 'O', prompt: 'Distancia interválica de ocho notas entre un sonido y su duplicación aguda.', options: ['Octava', 'Ostinato', 'Obertura', 'Opus'], answer: 0 },
  { letter: 'O', prompt: 'Pieza instrumental orquestal que abre y presenta una ópera o concierto.', options: ['Obertura', 'Oratorio', 'Octeto', 'Opus'], answer: 0 },
  { letter: 'O', prompt: 'Patrón rítmico o melódico que se repite persistentemente en una obra.', options: ['Ostinato', 'Obertura', 'Opus', 'Octeto'], answer: 0 },

  // --- LETRA P ---
  { letter: 'P', prompt: 'Indicación de dinámica que significa tocar con sonido suave.', options: ['Piano', 'Forte', 'Allegro', 'Staccato'], answer: 0 },
  { letter: 'P', prompt: 'Pauta de cinco líneas horizontales paralelas donde se escribe la música.', options: ['Pentagrama', 'Partitura', 'Pulso', 'Pausa'], answer: 0 },
  { letter: 'P', prompt: 'Gran bandoneonista y renovador del tango creador de Libertango y Adiós Nonino.', options: ['Astor Piazzolla', 'Osvaldo Pugliese', 'Sergei Prokofiev', 'Giacomo Puccini'], answer: 0 },
  { letter: 'P', prompt: 'Técnica de pellizcar las cuerdas con la yema del dedo en vez de usar el arco.', options: ['Pizzicato', 'Ponticello', 'Portamento', 'Presto'], answer: 0 },
  { letter: 'P', prompt: 'Latido regular y constante sobre el cual se apoya todo el ritmo.', options: ['Pulso', 'Paso', 'Pausa', 'Puntillo'], answer: 0 },

  // --- LETRA Q ---
  { letter: 'Q', prompt: 'Intervalo musical que comprende una distancia de cinco notas.', options: ['Quinta', 'Cuarta', 'Tercera', 'Octava'], answer: 0 },
  { letter: 'Q', prompt: 'Ensamble de cámara compuesto por cinco instrumentistas.', options: ['Quinteto', 'Cuarteto', 'Trío', 'Dúo'], answer: 0 },
  { letter: 'Q', prompt: 'Contiene Q: gran conjunto de instrumentos de cuerdas, vientos y percusión.', options: ['Orquesta', 'Banda', 'Coro', 'Dúo'], answer: 0 },
  { letter: 'Q', prompt: 'Flauta tradicional andina de caña abierta con orificios y bisel.', options: ['Quena', 'Quijada', 'Quinto', 'Quirquincho'], answer: 0 },
  { letter: 'Q', prompt: 'Instrumento folclórico de percusión hecho con la mandíbula de un burro o caballo.', options: ['Quijada', 'Quena', 'Quinto', 'Quitiplá'], answer: 0 },

  // --- LETRA R ---
  { letter: 'R', prompt: 'Organización de los sonidos y silencios en el transcurso del tiempo.', options: ['Ritmo', 'Timbre', 'Altura', 'Armonía'], answer: 0 },
  { letter: 'R', prompt: 'Figura musical que dura cuatro pulsos enteros en compás de 4/4.', options: ['Redonda', 'Blanca', 'Negra', 'Corchea'], answer: 0 },
  { letter: 'R', prompt: 'Compositor francés autor del famosísimo Boléro orquestal.', options: ['Maurice Ravel', 'Gioachino Rossini', 'Jean-Philippe Rameau', 'Sergei Rachmaninoff'], answer: 0 },
  { letter: 'R', prompt: 'Golpeteo continuo, rapidísimo y vibrante de baquetas sobre el tambor.', options: ['Redoble', 'Ritmo', 'Rallentando', 'Reposo'], answer: 0 },
  { letter: 'R', prompt: 'Forma musical basada en la alternancia de un estribillo principal y estrofas.', options: ['Rondó', 'Rapsodia', 'Réquiem', 'Recitativo'], answer: 0 },

  // --- LETRA S ---
  { letter: 'S', prompt: 'Práctica de leer partituras cantando o diciendo el nombre de las notas.', options: ['Solfeo', 'Síncopa', 'Sordina', 'Sonata'], answer: 0 },
  { letter: 'S', prompt: 'Gran obra para orquesta completa dividida en varios movimientos contrastantes.', options: ['Sinfonía', 'Sonata', 'Suite', 'Serenata'], answer: 0 },
  { letter: 'S', prompt: 'Alteración musical que eleva el sonido de la nota un semitono.', options: ['Sostenido', 'Bemol', 'Silencio', 'Signo'], answer: 0 },
  { letter: 'S', prompt: 'Articulación donde las notas se tocan muy cortas, picadas y separadas.', options: ['Staccato', 'Sostenido', 'Síncopa', 'Sordina'], answer: 0 },
  { letter: 'S', prompt: 'Dispositivo que se acopla al instrumento para atenuar o apagar su sonido.', options: ['Sordina', 'Silenciador', 'Soporte', 'Suela'], answer: 0 },

  // --- LETRA T ---
  { letter: 'T', prompt: 'Instrumento de viento-metal con tres pistones y sonido brillante y enérgico.', options: ['Trompeta', 'Timbal', 'Trombón', 'Fagot'], answer: 0 },
  { letter: 'T', prompt: 'Género musical y danza del Río de la Plata inmortalizado por orquestas típicas.', options: ['Tango', 'Tarantela', 'Twist', 'Tonada'], answer: 0 },
  { letter: 'T', prompt: 'Velocidad o paso con que se interpreta una obra musical.', options: ['Tempo', 'Timbre', 'Tono', 'Tutti'], answer: 0 },
  { letter: 'T', prompt: 'Tambores afinables con parche y caldera de cobre imprescindibles en la orquesta.', options: ['Timbales', 'Tamboriles', 'Triángulos', 'Tumbadoras'], answer: 0 },
  { letter: 'T', prompt: 'Instrumento de viento-metal que usa una vara móvil para cambiar las alturas.', options: ['Trombón', 'Trompeta', 'Tuba', 'Timbal'], answer: 0 },

  // --- LETRA U ---
  { letter: 'U', prompt: 'Cuando dos o más instrumentos tocan exactamente la misma nota al mismo tiempo.', options: ['Unísono', 'Último', 'Uno', 'Umbral'], answer: 0 },
  { letter: 'U', prompt: 'Pequeño instrumento hawaiano de cuatro cuerdas pulsadas.', options: ['Ukelele', 'Oboe', 'Viola', 'Arpa'], answer: 0 },
  { letter: 'U', prompt: 'Contiene U: el instrumento más voluminoso y grave de la familia de viento-metal.', options: ['Tuba', 'Trompa', 'Trompeta', 'Corneta'], answer: 0 },
  { letter: 'U', prompt: 'Contiene U: compositor austríaco romántico autor del lied La trucha y la Sinfonía Inconclusa.', options: ['Franz Schubert', 'Robert Schumann', 'Johann Strauss', 'Antonio Salieri'], answer: 0 },
  { letter: 'U', prompt: 'Contiene U: instrumento de viento-metal con tubo enrollado circularmente y pabellón ancho.', options: ['Trompa o Corno francés', 'Tuba', 'Trombón', 'Trompeta'], answer: 0 },

  // --- LETRA V ---
  { letter: 'V', prompt: 'Instrumento de cuatro cuerdas agudas que suele liderar la melodía en la orquesta.', options: ['Violín', 'Flauta', 'Oboe', 'Tuba'], answer: 0 },
  { letter: 'V', prompt: 'Instrumento de cuerda frotada de tamaño intermedio entre el violín y el violonchelo.', options: ['Viola', 'Violonchelo', 'Vihuela', 'Vibráfono'], answer: 0 },
  { letter: 'V', prompt: 'Danza elegante en compás de 3/4 que causó furor en Viena durante el siglo XIX.', options: ['Vals', 'Vidala', 'Villancico', 'Vallenato'], answer: 0 },
  { letter: 'V', prompt: 'Oscilación rápida y ondulante de la afinación producida con los dedos para dar expresividad.', options: ['Vibrato', 'Volata', 'Vivace', 'Voz'], answer: 0 },
  { letter: 'V', prompt: 'Ciudad bonaerense hogar y orgullo de nuestra querida Orquesta Escuela.', options: ['Florencio Varela', 'Vicente López', 'Villa Gesell', 'Valparaíso'], answer: 0 },

  // --- LETRA W ---
  { letter: 'W', prompt: 'Compositor alemán creador de la ópera El anillo del nibelungo y la cabalgata de las valquirias.', options: ['Richard Wagner', 'Carl Maria von Weber', 'Hugo Wolf', 'Émile Waldteufel'], answer: 0 },
  { letter: 'W', prompt: 'Nombre de pila del inmortal genio musical Mozart.', options: ['Wolfgang', 'Wilhelm', 'Walter', 'Werner'], answer: 0 },
  { letter: 'W', prompt: 'Compositor legendario de bandas sonoras como Star Wars, Harry Potter y Jurassic Park.', options: ['John Williams', 'Richard Wagner', 'Carl Maria von Weber', 'Andrew Lloyd Webber'], answer: 0 },
  { letter: 'W', prompt: 'Compositor romántico alemán autor de la ópera El cazador furtivo: Carl Maria von ___.', options: ['Weber', 'Wagner', 'Webern', 'Wolf'], answer: 0 },
  { letter: 'W', prompt: 'Danza austríaca rápida en 3/4 emparentada con el vals: danza de ___.', options: ['Walzer', 'Wolf', 'Webern', 'Wandlung'], answer: 0 },

  // --- LETRA X ---
  { letter: 'X', prompt: 'Instrumento de percusión con láminas de madera afinadas que se percuten con baquetas.', options: ['Xilófono', 'Xalam', 'Xaphoon', 'Xeremia'], answer: 0 },
  { letter: 'X', prompt: 'Contiene X: instrumento de viento inventado por Adolphe Sax muy usado en jazz y bandas.', options: ['Saxofón', 'Xaphoon', 'Xilófono', 'Xalam'], answer: 0 },
  { letter: 'X', prompt: 'Contiene X: acción de expulsar el aire de los pulmones para hacer vibrar un instrumento de viento.', options: ['Exhalar', 'Inspirar', 'Golpear', 'Frotar'], answer: 0 },
  { letter: 'X', prompt: 'Contiene X: concierto que concluye con grandes ovaciones y aplausos del público.', options: ['Exitoso', 'Apagado', 'Silencioso', 'Raro'], answer: 0 },
  { letter: 'X', prompt: 'Contiene X: nivel de virtuosismo y precisión técnica que demanda una obra difícil.', options: ['Exigencia', 'Extensión', 'Exilio', 'Éxtasis'], answer: 0 },

  // --- LETRA Y ---
  { letter: 'Y', prompt: 'Instrumento de percusión de origen africano con forma de copa, también llamado djembe.', options: ['Yembé', 'Yunque', 'Yaraví', 'Yodel'], answer: 0 },
  { letter: 'Y', prompt: 'Cantautor y guitarrista legendario del folclore argentino: Atahualpa ___.', options: ['Yupanqui', 'Yerba', 'Yamandú', 'Yrigoyen'], answer: 0 },
  { letter: 'Y', prompt: 'Contiene Y: director de orquesta que orienta y conduce con su batuta.', options: ['Guía y Conductor', 'Copista', 'Luthier', 'Atrilero'], answer: 0 },
  { letter: 'Y', prompt: 'Contiene Y: cadencia rítmica de tango creada por Osvaldo Pugliese: La ___.', options: ['Yumba', 'Yunta', 'Yapa', 'Yerba'], answer: 0 },
  { letter: 'Y', prompt: 'Contiene Y: al maestro Juan D’Arienzo lo apodaban el ___ del compás.', options: ['Rey', 'Príncipe', 'Duque', 'Conde'], answer: 0 },

  // --- LETRA Z ---
  { letter: 'Z', prompt: 'Instrumento andino de viento compuesto por hileras de cañas afinadas.', options: ['Zampoña', 'Zanfona', 'Zarzuela', 'Zambomba'], answer: 0 },
  { letter: 'Z', prompt: 'Danza lírica del folclore argentino que se baila ondeando pañuelos en el aire.', options: ['Zamba', 'Zarzuela', 'Zumba', 'Zodíaco'], answer: 0 },
  { letter: 'Z', prompt: 'Género lírico y teatral español que combina partes habladas con números cantados.', options: ['Zarzuela', 'Zamba', 'Zapateo', 'Zortziko'], answer: 0 },
  { letter: 'Z', prompt: 'Golpe rítmico con los pies característico del malambo argentino.', options: ['Zapateo', 'Zamba', 'Zarzuela', 'Zumbido'], answer: 0 },
  { letter: 'Z', prompt: 'Compositor alemán de bandas sonoras célebres como Gladiador, El Rey León e Interstellar.', options: ['Hans Zimmer', 'Frank Zappa', 'Domenico Zipoli', 'Pablo Zabaleta'], answer: 0 },
];
const ROSCO_LETTERS = [...new Set(ROSCO_QUESTIONS.map((q) => q.letter))];

// Elige preguntas evitando repetir las de partidas anteriores (se guarda en localStorage).
function pickFresh(key, indices, count) {
  let seen = [];
  let last = [];
  seen = readStoredJSON('oefv-seen-' + key, [], Array.isArray);
  last = readStoredJSON('oefv-last-' + key, [], Array.isArray);
  seen = Array.isArray(seen) ? [...new Set(seen.filter((index) => indices.includes(index)))] : [];
  last = Array.isArray(last) ? last.filter((index) => indices.includes(index)) : [];
  const fresh = shuffled(indices.filter((index) => !seen.includes(index)));
  let pick;
  if (fresh.length >= count) {
    pick = fresh.slice(0, count);
  } else {
    // Si el banco se va agotando, completa con otras preguntas, evitando las de la partida inmediatamente anterior.
    const available = shuffled(indices.filter((index) => !last.includes(index)));
    const combined = [...fresh, ...available.filter((index) => !fresh.includes(index))];
    pick = (combined.length >= count ? combined : shuffled(indices)).slice(0, count);
  }
  let nextSeen = [...new Set([...seen, ...pick])];
  if (nextSeen.length >= indices.length) nextSeen = pick;
  try {
    storageSet('oefv-seen-' + key, JSON.stringify(nextSeen));
    storageSet('oefv-last-' + key, JSON.stringify(pick));
  } catch (e) { /* noop */ }
  return pick;
}
function buildQuizOrder(gameKey, topic, count) {
  const bank = quizBankFor(gameKey, topic);
  if (gameKey === 'rosco') {
    return shuffled(ROSCO_LETTERS.map((letter) => {
      const ids = bank.map((q, i) => (q.letter === letter ? i : -1)).filter((i) => i >= 0);
      return pickFresh('rosco-' + letter, ids, 1)[0];
    }));
  }
  return pickFresh('trivia-' + topic, bank.map((_, i) => i), count);
}

function shuffled(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickChoices(answer, bank, count) {
  const distractors = bank.filter((item) => item !== answer && !(answer.value !== undefined && item.value === answer.value) && item.label !== answer.label);
  return shuffled([answer, ...shuffled(distractors).slice(0, count - 1)]);
}

function makeOrchestraQuestion(questionIndex) {
  const instrument = INSTRUMENTS[(questionIndex * 3 + Math.floor(Math.random() * INSTRUMENTS.length)) % INSTRUMENTS.length];
  const correct = ORCHESTRA_SECTIONS.find((section) => section.key === instrument.family);
  const options = pickChoices(correct, ORCHESTRA_SECTIONS, 4);
  return {
    prompt: `¿Dónde ubicarías el ${instrument.name.toLowerCase()}?`,
    topic: 'Nivel 7 · armamos la orquesta',
    options,
    answerIndex: options.indexOf(correct),
    explanation: correct.lesson,
    events: [{ at: 0.2, instrument, duration: 0.9, rate: 1 }],
    duration: 1.4,
    instrument,
  };
}

function makeSymphonyQuestion(level, questionIndex) {
  const difficulty = DIFFICULTIES[selectedDifficulty];
  const optionCount = 4;
  if (level === 7) return makeOrchestraQuestion(questionIndex);

  if (level <= 2) {
    const pulseCount = level === 1 ? 1 : questionIndex + 1;
    const bank = [1, 2, 3, 4].slice(0, optionCount).map((count) => ({ label: `${count} ${count === 1 ? 'pulso' : 'pulsos'}`, value: count }));
    const answer = { label: `${pulseCount} ${pulseCount === 1 ? 'pulso' : 'pulsos'}`, value: pulseCount };
    const options = pickChoices(answer, bank, Math.min(optionCount, bank.length));
    const beat = 0.62 * difficulty.symphonyTempo;
    return {
      prompt: '¿Cuántos pulsos escuchaste?',
      topic: level === 1 ? 'Nivel inicial · un pulso de marca' : 'Nivel 2 · pulsos regulares',
      options, answerIndex: options.indexOf(answer),
      explanation: `${pulseCount} ${pulseCount === 1 ? 'pulso' : 'pulsos'} regulares. Contá el espacio parejo entre cada marca.`,
      events: Array.from({ length: pulseCount }, (_, i) => ({ at: 0.15 + i * beat, kind: 'rhythm', beat: i, duration: 0.12 })),
      rhythm: { beats: 4, hits: Array.from({ length: pulseCount }, (_, i) => i) },
      duration: 0.15 + (pulseCount - 1) * beat + 0.65,
    };
  }

  const isMelody = level === 5 || level === 6;
  if (isMelody) {
    const catalog = level === 6 ? SYMPHONY_MELODIES_4 : SYMPHONY_MELODIES_3;
    const answer = catalog[Math.floor(Math.random() * catalog.length)];
    const options = pickChoices(answer, catalog, optionCount);
    const step = 0.48 * difficulty.symphonyTempo;
    return {
      prompt: '¿Qué dirección siguió la melodía?',
      topic: level === 5 ? 'Nivel 5 · melodía de 3 notas' : 'Nivel 6 · melodía de 4 notas',
      options, answerIndex: options.indexOf(answer),
      explanation: `La melodía fue ${answer.label}. Aguda = sube; grave = baja.`,
      events: answer.pitches.map((rate, i) => ({ at: 0.16 + i * step, kind: 'melody', duration: 0.3, rate })),
      melody: answer.pitches.map((rate) => Math.max(0, Math.min(3, Math.round((rate - 0.72) / 0.22)))),
      duration: 0.16 + (answer.pitches.length - 1) * step + 0.65,
    };
  }

  const catalog = level === 4 ? SYMPHONY_RHYTHMS_3 : SYMPHONY_RHYTHMS;
  const answer = catalog[Math.floor(Math.random() * catalog.length)];
  const options = pickChoices(answer, catalog, optionCount);
  const beat = (level === 3 ? 0.52 : 0.46) * difficulty.symphonyTempo;
  return {
    prompt: '¿Qué patrón rítmico escuchaste?',
    topic: level === 3 ? 'Nivel 3 · síncopas y subdivisiones' : 'Nivel 4 · tres tiempos, silencios y subdivisiones',
    options, answerIndex: options.indexOf(answer),
    explanation: `El patrón fue: ${answer.label}. “ti-ti” son dos sonidos rápidos; el silencio también ocupa tiempo.`,
    events: answer.hits.map((hit) => ({ at: 0.15 + hit * beat, kind: 'rhythm', beat: hit, duration: 0.12 })),
    rhythm: { beats: answer.beats, hits: answer.hits },
    duration: 0.15 + answer.beats * beat + 0.45,
  };
}

function quizBankFor(gameKey = quizGameKey, topic = selectedQuizTopic) {
  return gameKey === 'rosco' ? ROSCO_QUESTIONS : (MUSIC_TRIVIA[topic] || MUSIC_TRIVIA.historia);
}

function prepareQuizQuestion(raw) {
  const optionRows = raw.options.map((label, originalIndex) => ({ label, correct: originalIndex === raw.answer }));
  const mixed = shuffled(optionRows);
  return {
    prompt: raw.prompt,
    letter: raw.letter || '',
    fact: raw.fact || '',
    options: mixed.map((row) => row.label),
    answerIndex: mixed.findIndex((row) => row.correct),
  };
}

function openQuizSetup(gameKey) {
  quizGameKey = gameKey;
  if (gameKey === 'rosco') selectedQuizDifficulty = 'medio';
  selectedQuizTopic = gameKey === 'rosco' ? 'rosco' : (QUIZ_TOPICS.some((topic) => topic.key === selectedQuizTopic) ? selectedQuizTopic : 'historia');
  selectedQuizMode = 'solo';
  scene = 'quiz-setup';
}

function startSelectedQuiz() {
  if (selectedQuizMode === 'duel') {
    duelError = '';
    scene = 'quiz-room';
  } else startSoloQuiz(quizGameKey, selectedQuizTopic);
}

function playRoscoTick(letter, finalTick = false) {
  if (muted || !actx) return;
  const index = ROSCO_LETTERS.indexOf(letter);
  playExampleFrequency(finalTick ? 880 : 360 + Math.max(0, index) * 19, finalTick ? 0.2 : 0.07);
}

// Ruleta real: arranca muy rápido y frena de a poco hasta caer en la letra.
const ROSCO_SPIN_TIME = 2.8;
function makeRoscoSpin(targetLetter) {
  const n = ROSCO_LETTERS.length;
  const step = (Math.PI * 2) / n;
  const ti = Math.max(0, ROSCO_LETTERS.indexOf(targetLetter));
  const turns = 3 + Math.floor(Math.random() * 3);
  const end = turns * Math.PI * 2 - ti * step;
  return { target: targetLetter, end, rotation: 0, elapsed: 0, lastIdx: 0, lastTickAt: 0, current: ROSCO_LETTERS[0], done: false };
}

function roscoIndexAt(rotation) {
  const n = ROSCO_LETTERS.length;
  const step = (Math.PI * 2) / n;
  return ((Math.round(-rotation / step) % n) + n) % n;
}

function advanceRoscoSpin(state, dt) {
  const spin = state?.roscoSpin;
  if (!spin || state.phase !== 'spin') return;
  spin.elapsed += dt;
  const t = Math.min(1, spin.elapsed / ROSCO_SPIN_TIME);
  const ease = 1 - Math.pow(1 - t, 4);
  spin.rotation = spin.end * ease;
  const idx = roscoIndexAt(spin.rotation);
  if (idx !== spin.lastIdx) {
    spin.lastIdx = idx;
    spin.current = ROSCO_LETTERS[idx];
    if (t < 1 && spin.elapsed - spin.lastTickAt >= 0.075) {
      playRoscoTick(spin.current);
      spin.lastTickAt = spin.elapsed;
    }
  }
  if (t >= 1 && !spin.done) {
    spin.done = true;
    spin.current = spin.target;
    playRoscoTick(spin.target, true);
  }
  if (spin.elapsed > ROSCO_SPIN_TIME + 0.7) {
    state.phase = 'question';
    state.qTime = 0;
    state.elapsed = 0;
  }
}

function startSoloQuiz(gameKey, topic) {
  startCountdown(() => beginSoloQuiz(gameKey, topic), gameKey === 'rosco' ? '¡Girá el rosco!' : '¡Sebastián te desafía!');
}

function beginSoloQuiz(gameKey, topic) {
  duel = null;
  game = GAMES.find((entry) => entry.key === gameKey) || GAMES[3];
  selectedQuizTopic = topic;
  score = 0;
  combo = 0;
  time = 0;
  particles = [];
  popups = [];
  const bank = quizBankFor(gameKey, topic);
  const quizDifficulty = QUIZ_DIFFICULTIES[selectedQuizDifficulty];
  const order = buildQuizOrder(gameKey, topic, Math.min(quizDifficulty.questions, bank.length));
  st = {
    quiz: true, mode: 'solo', topic, order, round: 0, t: 0,
    total: order.length,
    timeLimit: gameKey === 'sinfonico' ? 10 : quizDifficulty.timeLimit, lives: quizDifficulty.lives,
    correctCount: 0, phase: 'question', qTime: 0, roscoResults: {},
  };
  scene = 'play';
  setMusicTrack(GAME_MUSIC.sinfonico);
  music.volume = 0.08;
  loadQuizQuestion();
}

function loadQuizQuestion() {
  if (!st.quiz || st.round >= st.total) {
    endGame();
    return;
  }
  const raw = quizBankFor(game.key, st.topic)[st.order[st.round]];
  st.question = prepareQuizQuestion(raw);
  st.phase = game.key === 'rosco' ? 'spin' : 'question';
  st.roscoSpin = game.key === 'rosco' ? makeRoscoSpin(st.question.letter) : null;
  st.responseCorrect = null;
  st.selectedAnswer = -1;
  st.qTime = 0;
  st.feedbackTime = 0;
}

function answerSoloQuiz(index, timedOut = false) {
  if (!st.quiz || st.phase !== 'question') return;
  st.selectedAnswer = index;
  st.responseCorrect = index === st.question.answerIndex;
  if (game.key === 'rosco' && st.question.letter) {
    st.roscoResults ||= {};
    st.roscoResults[st.question.letter] = st.responseCorrect;
  }
  if (st.responseCorrect) {
    st.correctCount++;
    reward(W / 2, H * 0.48, 100, '¡Respuesta correcta!');
    playCorrectJingle();
  } else {
    miss(W / 2, H * 0.48, timedOut ? '¡Se acabó el tiempo!' : '¡Probá la próxima!');
    if (st.lives !== null) st.lives--;
  }
  st.phase = 'feedback';
  st.feedbackTime = 0;
}

function generateRoomCode() {
  return 'MUS' + Math.floor(100 + Math.random() * 900);
}

function openRoomCodeEntry() {
  roomCodeInput.value = '';
  roomCodeModal.style.display = 'flex';
  requestAnimationFrame(() => roomCodeInput.focus());
}

function publishDuelPresence(extra = {}) {
  if (!duelRoom || !duel || containsProfanity(playerName)) return;
  const payload = {
    playerId: localPlayerId,
    id: localPlayerId,
    name: playerName,
    avatar: profile.avatar,
    role: duel.isHost ? 'host' : 'guest',
    duelReady: true,
    duelRound: duel.round ?? -1,
    duelAnswer: duel.myAnswer ?? -1,
    score: duel.score || 0,
    ...extra,
  };
  duelRoom.publishPresence(payload);
  const mine = duel.players.find((player) => player.playerId === localPlayerId);
  if (mine) Object.assign(mine, payload);
  else duel.players.push(payload);
}

function startDuelRoom(code, isHost) {
  if (!db) {
    duelError = 'La conexión online no está disponible. Revisá la configuración de InstantDB.';
    scene = 'quiz-room';
    return;
  }
  try {
    duelRoom = db.joinRoom('music-quiz', code);
    duel = {
      code,
      isHost,
      gameKey: quizGameKey,
      topic: quizGameKey === 'rosco' ? 'rosco' : selectedQuizTopic,
      phase: 'waiting',
      round: -1,
      total: 0,
      score: 0,
      myAnswer: null,
      elapsed: 0,
      feedbackTime: 0,
      players: [],
      questionIds: [],
      question: null,
      roscoResults: {},
    };
    duelPlayers = [];
    duelRoom.subscribePresence({}, (data) => {
      if (!duel) return;
      const all = [];
      if (data.user) all.push(data.user);
      Object.values(data.peers || {}).forEach((peer) => all.push(peer));
      duel.players = all.filter((player) => player && player.playerId && typeof player.name === 'string' && !containsProfanity(player.name));
      duelPlayers = duel.players;
    });
    duelRoom.subscribeTopic('quiz-match', (event) => {
      if (event?.sender === localPlayerId) return;
      receiveDuelEvent(event);
    });
    scene = 'duel-lobby';
    publishDuelPresence({ duelReady: true, duelAnswer: -1, duelRound: -1, score: 0 });
  } catch (error) {
    duel = null;
    duelRoom = null;
    duelError = 'No se pudo abrir la sala. Probá con otro código.';
    scene = 'quiz-room';
  }
}

function broadcastDuelEvent(event) {
  if (!duelRoom || !duel) return;
  const payload = { ...event, sender: localPlayerId };
  receiveDuelEvent(payload);
  duelRoom.publishTopic('quiz-match', payload);
}

function startDuelMatch() {
  if (!duel?.isHost || duel.players.filter((player) => player.duelReady).length < 2) return;
  const bank = quizBankFor(duel.gameKey, duel.topic);
  const quizDifficulty = QUIZ_DIFFICULTIES[selectedQuizDifficulty];
  duel.questionIds = buildQuizOrder(duel.gameKey, duel.topic, Math.min(quizDifficulty.questions, bank.length));
  duel.total = duel.questionIds.length;
  duel.score = 0;
  duel.round = 0;
  duel.roscoResults = {};
  duel.difficulty = selectedQuizDifficulty;
  duel.timeLimit = duel.gameKey === 'sinfonico' ? 10 : quizDifficulty.timeLimit;
  st = { quiz: false, t: 0 };
  game = GAMES.find((entry) => entry.key === duel.gameKey) || GAMES[3];
  broadcastDuelEvent({
    type: 'countdown', gameKey: duel.gameKey, topic: duel.topic,
    total: duel.total, difficulty: duel.difficulty,
  });
}

function beginDuelRound() {
  if (!duel?.isHost) return;
  if (duel.round >= duel.total) {
    const finalScores = duel.players.map((player) => ({ playerId: player.playerId, name: player.name, score: player.score || 0 }));
    broadcastDuelEvent({ type: 'finish', scores: finalScores });
    return;
  }
  const bank = quizBankFor(duel.gameKey, duel.topic);
  const question = prepareQuizQuestion(bank[duel.questionIds[duel.round]]);
  broadcastDuelEvent({
    type: 'question',
    gameKey: duel.gameKey,
    topic: duel.topic,
    round: duel.round,
    total: duel.total,
    difficulty: duel.difficulty,
    timeLimit: duel.timeLimit,
    question,
  });
}

function receiveDuelEvent(event) {
  if (!event || !duel) return;
  if (event.type === 'countdown') {
    duel.gameKey = event.gameKey;
    duel.topic = event.topic;
    duel.total = event.total;
    duel.difficulty = event.difficulty;
    duel.timeLimit = event.gameKey === 'sinfonico' ? 10 : (QUIZ_DIFFICULTIES[event.difficulty]?.timeLimit || 13);
    duel.round = 0;
    duel.roscoResults = {};
    selectedQuizDifficulty = event.difficulty;
    st = { quiz: false, t: 0 };
    game = GAMES.find((entry) => entry.key === event.gameKey) || GAMES[3];
    startCountdown(() => {
      if (!duel) return;
      if (duel.isHost) {
        scene = 'play';
        beginDuelRound();
      } else scene = 'duel-lobby';
    }, event.gameKey === 'rosco' ? '¡Girá el rosco!' : '¡Sebastián te desafía!');
  } else if (event.type === 'question') {
    duel.gameKey = event.gameKey;
    duel.topic = event.topic;
    duel.round = event.round;
    duel.total = event.total;
    duel.timeLimit = event.timeLimit || QUIZ_DIFFICULTIES[event.difficulty]?.timeLimit || 13;
    duel.question = event.question;
    duel.phase = event.gameKey === 'rosco' ? 'spin' : 'question';
    duel.roscoSpin = event.gameKey === 'rosco' ? makeRoscoSpin(duel.question.letter) : null;
    duel.myAnswer = null;
    duel.elapsed = 0;
    game = GAMES.find((entry) => entry.key === event.gameKey) || GAMES[3];
    scene = 'play';
    publishDuelPresence({ duelRound: event.round, duelAnswer: -1, score: duel.score });
  } else if (event.type === 'result') {
    duel.phase = 'feedback';
    duel.correctIndex = event.correctIndex;
    duel.fact = event.fact;
    duel.feedbackTime = 0;
    duel.roundScores = (Array.isArray(event.scores) ? event.scores : []).filter((player) =>
      player && typeof player.name === 'string' && !containsProfanity(player.name));
  } else if (event.type === 'finish') {
    if (!game) game = GAMES.find((entry) => entry.key === duel.gameKey) || GAMES[3];
    duel.finalScores = (Array.isArray(event.scores) ? event.scores : duel.players.map((player) => ({ playerId: player.playerId, name: player.name, score: player.score || 0 })))
      .filter((player) => player && typeof player.name === 'string' && !containsProfanity(player.name));
    score = duel.score;
    endGame();
  }
}

function submitDuelAnswer(index, timedOut = false) {
  if (!duel || duel.phase !== 'question' || duel.myAnswer !== null) return;
  duel.myAnswer = index;
  const right = index === duel.question.answerIndex;
  if (game?.key === 'rosco' && duel.question.letter) {
    duel.roscoResults ||= {};
    duel.roscoResults[duel.question.letter] = right;
  }
  if (right) {
    duel.score += 100;
    reward(W / 2, H * 0.48, 100, '¡Bien!');
    playCorrectJingle();
  } else {
    miss(W / 2, H * 0.48, timedOut ? '¡Se acabó el tiempo!' : '¡A por la próxima!');
  }
  publishDuelPresence({ duelRound: duel.round, duelAnswer: index, score: duel.score });
}

function updateQuiz(dt) {
  if (st.quiz) {
    if (st.phase === 'question') {
      st.qTime += dt;
      if (st.qTime > st.timeLimit) answerSoloQuiz(-1, true);
    } else if (st.phase === 'feedback') {
      st.feedbackTime += dt;
      if (st.feedbackTime > 4.8) {
        if (st.lives !== null && st.lives <= 0) {
          endGame();
          return;
        }
        st.round++;
        loadQuizQuestion();
      }
    }
  }
  if (duel?.phase === 'question' && !duel.isHost) duel.elapsed += dt;
  if (!duel || !duel.isHost) return;
  if (duel.phase === 'question') {
    duel.elapsed += dt;
    const active = duel.players.filter((player) => player.duelReady);
    const allAnswered = active.length >= 2 && active.every((player) => player.duelRound === duel.round && player.duelAnswer >= 0);
    if (allAnswered || duel.elapsed > (duel.timeLimit || 13)) {
      const scores = duel.players.map((player) => ({ playerId: player.playerId, name: player.name, score: player.score, answer: player.duelAnswer }));
      broadcastDuelEvent({ type: 'result', correctIndex: duel.question.answerIndex, fact: duel.question.fact, scores });
    }
  } else if (duel.phase === 'feedback') {
    duel.feedbackTime += dt;
    if (duel.feedbackTime > 4.8) {
      duel.round++;
      beginDuelRound();
    }
  }
}

function loadSymphonyQuestion() {
  st.question = makeSymphonyQuestion(st.level, st.questionIndex);
  st.story = SYMPHONY_STORIES[st.level];
  st.phase = 'story';
  st.playClock = -0.35;
  st.eventIndex = 0;
  st.lit = -1;
  st.litT = 0;
}

function beginSymphonyExample() {
  if (st.phase !== 'story') return;
  replaySymphonyExample();
}

function replaySymphonyExample() {
  if (st.phase === 'feedback' || st.phase === 'episode-clear') return;
  music.pause();
  st.phase = 'preview';
  st.playClock = -0.35;
  st.eventIndex = 0;
  st.lit = -1;
  st.litT = 0;
}

function answerSymphony(index) {
  if (st.phase !== 'answer') return;
  const correct = index === st.question.answerIndex;
  if (correct) {
    reward(W / 2, H * 0.38, 120 + st.level * 30, '¡Correcto!');
    playCorrectJingle();
    st.feedbackText = `¡Bien! ${st.question.explanation}`;
  } else {
    st.lives--;
    miss(W / 2, H * 0.38, 'Escuchá la diferencia');
    st.feedbackText = `La respuesta era: ${st.question.options[st.question.answerIndex].label}. ${st.question.explanation}`;
    if (st.lives <= 0) {
      endGame();
      return;
    }
  }
  st.phase = 'feedback';
  st.feedbackTimer = 0;
}

function advanceSymphonyEpisode() {
  if (st.level >= 7) {
    endGame();
    return;
  }
  st.level++;
  st.questionIndex = 0;
  loadSymphonyQuestion();
}

// ---------- Dirigir: patrones reales de dirección con batuta virtual ----------
// Puntos de cada tiempo (ictus) normalizados dentro de la zona de dirección.
const CONDUCTOR_PATTERNS = {
  2: { points: [[0.5, 0.86], [0.5, 0.16]], labels: ['ABAJO', 'ARRIBA'] },
  3: { points: [[0.5, 0.86], [0.86, 0.58], [0.5, 0.16]], labels: ['ABAJO', 'AFUERA', 'ARRIBA'] },
  4: { points: [[0.5, 0.86], [0.14, 0.6], [0.86, 0.6], [0.5, 0.16]], labels: ['ABAJO', 'ADENTRO', 'AFUERA', 'ARRIBA'] },
};
const CONDUCTOR_TOLERANCE = { facil: 1.3, medio: 1, dificil: 0.74 };

function conductorBeatDuration(meter, rate = 1) {
  return (meter === 2 ? 60 / 80 : meter === 3 ? 60 / 72 : 60 / 64) / rate;
}

// Zona libre del escenario (debajo de los textos y encima del zorro), adaptada a pantallas verticales.
function conductorZone() {
  const top = H * 0.275;
  const bottom = H * 0.655;
  const size = Math.min(W * 0.84, bottom - top);
  return { x: W / 2 - size / 2, y: (top + bottom) / 2 - size / 2, w: size, h: size };
}

function conductorIctus(meter, index, zone) {
  const p = CONDUCTOR_PATTERNS[meter].points[index % meter];
  return { x: zone.x + p[0] * zone.w, y: zone.y + p[1] * zone.h };
}

// Curva entre dos tiempos: rebote hacia arriba tras cada ictus y caída suave hacia el siguiente.
function conductorPathPoint(meter, beat, s, zone) {
  const pts = CONDUCTOR_PATTERNS[meter].points;
  const a = pts[beat % meter];
  const b = pts[(beat + 1) % meter];
  const c1 = [a[0] + (b[0] - a[0]) * 0.15 + 0.08, a[1] - 0.2];
  const c2 = [b[0] + 0.04, b[1] - 0.16];
  const u = 1 - s;
  const x = u * u * u * a[0] + 3 * u * u * s * c1[0] + 3 * u * s * s * c2[0] + s * s * s * b[0];
  const y = u * u * u * a[1] + 3 * u * u * s * c1[1] + 3 * u * s * s * c2[1] + s * s * s * b[1];
  return { x: zone.x + x * zone.w, y: zone.y + y * zone.h };
}

function conductorClockState() {
  const synced = activeMusicSrc === CONDUCTOR_TRACKS[st.meter] && !music.paused;
  return {
    clock: synced ? music.currentTime : st.t,
    rate: synced ? 1 : DIFFICULTIES[selectedDifficulty].conductorTempo,
  };
}

function conductorTarget(t, meter = st.meter || selectedMeter, rate = 1, zone = conductorZone()) {
  const beatDuration = conductorBeatDuration(meter, rate);
  const position = Math.max(0, t) / beatDuration;
  const absoluteBeat = Math.floor(position);
  const beat = absoluteBeat % meter;
  const fraction = position - absoluteBeat;
  const p = conductorPathPoint(meter, beat, fraction, zone);
  return { x: p.x, y: p.y, beat, meter, fraction, absoluteBeat, beatDuration, zone };
}

function conductorTolerance(zone) {
  return zone.w * 0.17 * (CONDUCTOR_TOLERANCE[selectedDifficulty] || 1);
}

// Evalúa el tiempo que acaba de pasar: cercanía de la batuta al ictus dentro de la ventana rítmica.
function resolveConductorBeat() {
  const index = st.judgeIdx;
  const best = st.judgeBest;
  st.judgeId = null;
  const zone = conductorZone();
  const ictus = conductorIctus(st.meter, index, zone);
  const tolerance = conductorTolerance(zone);
  const downbeat = index === 0;
  if (!(best < tolerance)) {
    if (combo > 0) popups.push({ x: ictus.x, y: ictus.y - 20 * U, text: 'Fuera de compás', life: 0.8, color: '#ff9a9a' });
    combo = 0;
    st.rings.push({ x: ictus.x, y: ictus.y, life: 0.6, color: '255,110,110', big: false, miss: true });
    return;
  }
  const perfect = best < tolerance * 0.5;
  combo++;
  const gained = (perfect ? 30 : 18) + (downbeat ? 10 : 0) + Math.min(combo, 10) * 4;
  score += gained;
  const label = downbeat ? '¡Pulso fuerte!' : perfect ? '¡Perfecto!' : '¡Bien!';
  popups.push({ x: ictus.x, y: ictus.y - 22 * U, text: `${label} +${gained}`, life: 1, color: perfect || downbeat ? '#ffd84a' : '#bfefff' });
  st.rings.push({ x: ictus.x, y: ictus.y, life: 1, color: '255,216,74', big: downbeat, hit: true });
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 70;
    particles.push({ x: ictus.x, y: ictus.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.7, c: i % 2 ? '#fff3c4' : '#ffd84a' });
  }
  playMetalNote(index);
}

function updateConductor(dt) {
  if (!st.rings) st.rings = [];
  if (!st.trail) st.trail = [];
  const { clock, rate } = conductorClockState();
  const tg = conductorTarget(clock, st.meter, rate);
  const active = pointer.down || keyboardConductorHeld;
  const bx = keyboardConductorHeld ? tg.x : pointer.x;
  const by = keyboardConductorHeld ? tg.y : pointer.y;
  st.baton = active ? { x: bx, y: by } : null;
  // Batuta luminosa visual: sigue al dedo con un suavizado muy corto (la puntuación usa la posición real).
  if (active) {
    if (!st.batonView) st.batonView = { x: bx, y: by, vx: 0 };
    const k = 1 - Math.exp(-dt * 32);
    const nx = st.batonView.x + (bx - st.batonView.x) * k;
    const ny = st.batonView.y + (by - st.batonView.y) * k;
    st.batonView.vx = dt > 0 ? (nx - st.batonView.x) / dt : 0;
    st.batonView.x = nx;
    st.batonView.y = ny;
  } else {
    st.batonView = null;
  }
  st.trail = st.trail.filter((p) => st.t - p.t < 0.3);
  if (active) st.trail.push({ x: st.batonView.x, y: st.batonView.y, t: st.t });
  st.close = active && Math.hypot(bx - tg.x, by - tg.y) < conductorTolerance(tg.zone);
  // Ventana rítmica alrededor de cada tiempo (antes y después del ictus).
  const windowSeconds = Math.min(0.2, tg.beatDuration * 0.3);
  const since = tg.fraction * tg.beatDuration;
  const until = (1 - tg.fraction) * tg.beatDuration;
  let id = null;
  let index = 0;
  if (until < windowSeconds) { id = tg.absoluteBeat + 1; index = (tg.beat + 1) % st.meter; }
  else if (since < windowSeconds) { id = tg.absoluteBeat; index = tg.beat; }
  if (st.judgeId != null && st.judgeId !== id) resolveConductorBeat();
  if (id != null && st.t > 0.6) {
    if (st.judgeId !== id) { st.judgeId = id; st.judgeIdx = index; st.judgeBest = Infinity; }
    const ictus = conductorIctus(st.meter, index, tg.zone);
    const d = active ? Math.hypot(bx - ictus.x, by - ictus.y) : Infinity;
    st.judgeBest = Math.min(st.judgeBest, d);
  }
  st.rings.forEach((ring) => { ring.life -= dt * 1.8; });
  st.rings = st.rings.filter((ring) => ring.life > 0);
}

// Dibuja la ilustración tal cual, sin rotaciones, balanceos ni deformaciones.
function drawStaticCharacter(img, cx, baseline, h) {
  if (!img.complete || !img.naturalWidth) return;
  const w = (img.naturalWidth / img.naturalHeight) * h;
  ctx.drawImage(img, cx - w / 2, baseline - h, w, h);
}

function strokeConductorPattern(meter, zone, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let beat = 0; beat < meter; beat++) {
    for (let k = 0; k <= 24; k++) {
      const p = conductorPathPoint(meter, beat, k / 24, zone);
      if (beat === 0 && k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
}

function drawConductorBaton(x, y) {
  const trail = st.trail || [];
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const alpha = Math.max(0, 1 - (st.t - b.t) / 0.3);
    ctx.strokeStyle = `rgba(255,236,170,${0.5 * alpha})`;
    ctx.lineWidth = (2 + 5 * alpha) * U;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  // Batuta luminosa independiente: punta en el dedo, vara fina blanca y mango dorado hacia abajo a la derecha.
  // Se inclina apenas según la velocidad horizontal para dar sensación de fluidez.
  const vx = (st.batonView && st.batonView.vx) || 0;
  const tilt = Math.max(-0.35, Math.min(0.35, -vx / 2400));
  const angle = 1.1 + tilt; // dirección del mango respecto de la punta
  const len = 52 * U;
  const hx = x + Math.cos(angle) * len;
  const hy = y + Math.sin(angle) * len;
  const gx = x + Math.cos(angle) * len * 0.72;
  const gy = y + Math.sin(angle) * len * 0.72;
  // Contorno oscuro suave para que se lea sobre el fondo.
  ctx.strokeStyle = 'rgba(8,8,24,0.5)';
  ctx.lineWidth = 5 * U;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(x, y); ctx.stroke();
  // Vara blanca con brillo.
  ctx.shadowColor = 'rgba(255,240,190,0.9)';
  ctx.shadowBlur = 10 * U;
  const shaft = ctx.createLinearGradient(gx, gy, x, y);
  shaft.addColorStop(0, '#fff6dc');
  shaft.addColorStop(1, '#ffffff');
  ctx.strokeStyle = shaft;
  ctx.lineWidth = 2.2 * U;
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(x, y); ctx.stroke();
  // Mango dorado con anillo.
  ctx.shadowBlur = 6 * U;
  ctx.shadowColor = 'rgba(255,200,80,0.8)';
  ctx.strokeStyle = '#e8b43a';
  ctx.lineWidth = 5.5 * U;
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = '#ffd84a';
  ctx.beginPath(); ctx.arc(gx, gy, 3.4 * U, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f5c443';
  ctx.beginPath(); ctx.arc(hx, hy, 3.6 * U, 0, Math.PI * 2); ctx.fill();
  // Punta luminosa (dorada cuando está sobre la luz guía).
  ctx.shadowColor = st.close ? '#ffd84a' : '#fff3c4';
  ctx.shadowBlur = 16 * U;
  ctx.fillStyle = st.close ? 'rgba(255,216,74,0.35)' : 'rgba(255,246,216,0.28)';
  ctx.beginPath(); ctx.arc(x, y, 9 * U, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = st.close ? '#ffe57a' : '#ffffff';
  ctx.beginPath(); ctx.arc(x, y, 3.6 * U, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Panel oscuro translúcido para mejorar la lectura de textos sobre el fondo.
function conductorPanel(x, y, w, h, r = 12) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,28,0.62)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r * U); ctx.fill();
  ctx.strokeStyle = 'rgba(255,216,74,0.28)';
  ctx.lineWidth = 1.2 * U;
  ctx.stroke();
  ctx.restore();
}

function drawConductorHud() {
  const top = H * 0.143;
  const h = H * 0.105;
  conductorPanel(W * 0.05, top, W * 0.9, h, 14);
  text('Compás ' + st.meter + '/4  ·  ' + CONDUCTOR_PATTERNS[st.meter].labels.join(' · ').toLowerCase(), W / 2, top + h * 0.3, 14, '#ffd84a');
  text('Tiempo: ' + Math.max(0, Math.ceil(st.duration - st.t)), W / 2, top + h * 0.58, 13, '#ffffff');
  const idle = !st.baton;
  const pulse = idle ? 0.75 + 0.25 * Math.sin(time * 5) : 1;
  ctx.globalAlpha = pulse;
  text(idle ? '👆 Tocá y seguí la luz con tu batuta' : 'Llevá la batuta a cada número cuando llega la luz', W / 2, top + h * 0.87, 11.5, idle ? '#ffe9a8' : '#e6f4ff');
  ctx.globalAlpha = 1;
}

function drawConductorStage() {
  const { clock, rate } = conductorClockState();
  const meter = st.meter;
  const tg = conductorTarget(clock, meter, rate);
  const zone = tg.zone;
  const pattern = CONDUCTOR_PATTERNS[meter];
  // Zorro estático debajo de la zona de dirección.
  const foxTop = zone.y + zone.h + 10 * U;
  const foxH = Math.max(40, Math.min(H * 0.27, H * 0.965 - foxTop));
  // Única animación del zorro: un leve desplazamiento vertical de la imagen completa, sin deformarla.
  const foxSway = Math.sin(time * 1.6) * 1.5 * U;
  drawStaticCharacter(CHARACTERS[0].img, W / 2, H * 0.965 + foxSway, foxH);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Fondo semitransparente de la zona.
  ctx.fillStyle = 'rgba(10,12,32,0.26)';
  ctx.beginPath(); ctx.roundRect(zone.x - 10 * U, zone.y - 16 * U, zone.w + 20 * U, zone.h + 26 * U, 18 * U); ctx.fill();
  ctx.strokeStyle = 'rgba(255,216,74,0.22)';
  ctx.lineWidth = 1.2 * U;
  ctx.stroke();
  // Trayectoria completa del compás.
  strokeConductorPattern(meter, zone, 7 * U, 'rgba(255,226,140,0.16)');
  strokeConductorPattern(meter, zone, 2 * U, 'rgba(255,255,255,0.22)');
  // Tramo actual resaltado.
  ctx.strokeStyle = 'rgba(255,216,74,0.55)';
  ctx.lineWidth = 3.5 * U;
  ctx.beginPath();
  for (let k = 0; k <= 24; k++) {
    const p = conductorPathPoint(meter, tg.beat, k / 24, zone);
    if (!k) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // Puntos de cada tiempo; el 1 (pulso fuerte) es dorado y más grande.
  pattern.points.forEach((_, i) => {
    const p = conductorIctus(meter, i, zone);
    const landed = tg.beat === i && tg.fraction < 0.3;
    const pulse = landed ? 1 - tg.fraction / 0.3 : 0;
    // Puntos más grandes y con borde oscuro + aro blanco: fáciles de ver y de tocar con el dedo.
    const radius = (i === 0 ? 19 : 16) * U * (1 + pulse * 0.25);
    ctx.fillStyle = 'rgba(8,10,28,0.7)';
    ctx.beginPath(); ctx.arc(p.x, p.y, radius + 3.5 * U, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = i === 0 ? '#ffd84a' : '#bfefff';
    ctx.shadowBlur = (6 + pulse * 14) * U;
    ctx.fillStyle = i === 0 ? `rgba(255,216,74,${0.85 + pulse * 0.15})` : `rgba(206,242,255,${0.8 + pulse * 0.2})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${0.7 + pulse * 0.3})`;
    ctx.lineWidth = 2 * U;
    ctx.stroke();
    text(String(i + 1), p.x, p.y + (i === 0 ? 6.5 : 5.5) * U, i === 0 ? 18 : 15, i === 0 ? '#2a1800' : '#0c1630');
    const labelBelow = p.y < zone.y + zone.h * 0.5;
    const ly = p.y + (labelBelow ? radius + 16 * U : -radius - 9 * U);
    const lw = pattern.labels[i].length * 7 * U + 14 * U;
    ctx.fillStyle = 'rgba(8,10,28,0.6)';
    ctx.beginPath(); ctx.roundRect(p.x - lw / 2, ly - 11 * U, lw, 15 * U, 7 * U); ctx.fill();
    text(pattern.labels[i], p.x, ly, 9, '#ffffff');
  });
  // Anillos de acierto.
  (st.rings || []).forEach((ring) => {
    // Destello: dorado al acertar, rojo discreto al fallar.
    if (ring.hit || ring.miss) {
      const a = Math.max(0, ring.life) * (ring.hit ? 0.45 : 0.28);
      ctx.fillStyle = `rgba(${ring.color},${a})`;
      ctx.beginPath(); ctx.arc(ring.x, ring.y, (ring.hit ? 24 : 20) * U, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = `rgba(${ring.color},${Math.max(0, ring.life)})`;
    ctx.lineWidth = (ring.big ? 3.5 : 2.2) * U;
    ctx.beginPath(); ctx.arc(ring.x, ring.y, (ring.big ? 16 : 11) * U + (1 - ring.life) * (ring.big ? 34 : 22) * U, 0, Math.PI * 2); ctx.stroke();
  });
  // Luz guía que recorre la figura al ritmo de la música.
  for (let k = 8; k >= 1; k--) {
    const back = Math.max(0, tg.fraction - k * 0.035);
    const p = conductorPathPoint(meter, tg.beat, back, zone);
    ctx.fillStyle = `rgba(255,240,190,${0.05 + (8 - k) * 0.035})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, (3 + (8 - k) * 0.7) * U, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowColor = '#fff3c4';
  ctx.shadowBlur = 14 * U;
  ctx.fillStyle = '#fff6d8';
  ctx.beginPath(); ctx.arc(tg.x, tg.y, 9 * U, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = st.close ? 'rgba(126,240,160,0.9)' : 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2 * U;
  ctx.beginPath(); ctx.arc(tg.x, tg.y, conductorTolerance(zone) * 0.5, 0, Math.PI * 2); ctx.stroke();
  // Indicador de tiempos del compás.
  const dotsY = zone.y - 6 * U;
  for (let i = 0; i < meter; i++) {
    const dx = W / 2 + (i - (meter - 1) / 2) * 20 * U;
    const on = i === tg.beat;
    ctx.fillStyle = on ? (i === 0 ? '#ffd84a' : '#bfefff') : 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(dx, dotsY, (i === 0 ? 5 : 4) * U * (on ? 1.3 : 1), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  const view = st.batonView || st.baton;
  if (view) drawConductorBaton(view.x, view.y);
}

// Vista previa del menú de compás: zorro estático y figura del patrón, sin animar al personaje.
function drawConductorCoach(meter, cx, baseline, spriteHeight) {
  drawStaticCharacter(CHARACTERS[0].img, cx - W * 0.2, baseline, spriteHeight);
  const size = spriteHeight * 0.9;
  const zone = { x: cx + W * 0.02, y: baseline - size - spriteHeight * 0.04, w: size, h: size };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeConductorPattern(meter, zone, 2.5 * U, 'rgba(255,226,140,0.55)');
  CONDUCTOR_PATTERNS[meter].points.forEach((_, i) => {
    const p = conductorIctus(meter, i, zone);
    ctx.fillStyle = i === 0 ? '#ffd84a' : 'rgba(190,239,255,0.8)';
    ctx.beginPath(); ctx.arc(p.x, p.y, (i === 0 ? 5 : 3.5) * U, 0, Math.PI * 2); ctx.fill();
  });
  const preview = conductorTarget(time * 0.8, meter, 0.78, zone);
  ctx.shadowColor = '#fff3c4';
  ctx.shadowBlur = 8 * U;
  ctx.fillStyle = '#fff6d8';
  ctx.beginPath(); ctx.arc(preview.x, preview.y, 4.5 * U, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function meterLesson(meter) {
  if (meter === 2) return '2/4 · fuerte, suave';
  if (meter === 3) return '3/4 · fuerte, suave, suave';
  return '4/4 · fuerte, suave, medio, suave';
}

// ---------- Clase musical ----------
const LESSONS = [
  {
    title: 'Historia musical', type: 'trivia', category: 'Historia de la música', icon: '🏛️',
    questions: [
      { prompt: '¿Qué edad tenía Mozart cuando compuso su primera sinfonía?', options: ['Alrededor de 8 años', '20 años', '35 años', '60 años'], answer: 0, fact: 'Mozart escribió su Sinfonía n.º 1, K. 16, durante su infancia.' },
      { prompt: '¿Qué hizo Beethoven cuando empezó a perder la audición?', options: ['Siguió componiendo', 'Dejó la música para siempre', 'Se dedicó al canto', 'Inventó el saxofón'], answer: 0, fact: 'Beethoven siguió componiendo; su Novena sinfonía es uno de sus grandes logros.' },
      { prompt: '¿Qué apodo tenía Antonio Vivaldi?', options: ['El cura rojo', 'El rey del piano', 'El mago del vals', 'El príncipe azul'], answer: 0, fact: 'Vivaldi era sacerdote y su cabello rojizo inspiró el apodo “Il Prete Rosso”.' },
      { prompt: '¿Cuántos hijos tuvo Johann Sebastian Bach?', options: ['20', '2', '5', '12'], answer: 0, fact: 'Bach tuvo 20 hijos; varios de ellos también se dedicaron a la música.' },
      { prompt: '¿Quién compuso el ballet El lago de los cisnes?', options: ['Piotr Ilich Chaikovski', 'Joseph Haydn', 'Erik Satie', 'George Gershwin'], answer: 0, fact: 'Chaikovski compuso El lago de los cisnes, estrenado en 1877.' },
      { prompt: '¿Quién compuso Las cuatro estaciones?', options: ['Antonio Vivaldi', 'Johann Strauss', 'Frédéric Chopin', 'Claude Debussy'], answer: 0, fact: 'Vivaldi publicó Las cuatro estaciones en 1725: cuatro conciertos para violín.' },
      { prompt: '¿A qué período pertenece Johann Sebastian Bach?', options: ['Barroco', 'Romanticismo', 'Clasicismo', 'Siglo XX'], answer: 0, fact: 'Bach (1685–1750) es una de las grandes figuras del Barroco.' },
      { prompt: '¿Qué compositor es conocido como el “poeta del piano”?', options: ['Frédéric Chopin', 'Gustav Mahler', 'Richard Wagner', 'Antonín Dvořák'], answer: 0, fact: 'Chopin dedicó casi toda su obra al piano: nocturnos, valses, polonesas y más.' },
      { prompt: '¿Qué compositor argentino escribió el ballet Estancia?', options: ['Alberto Ginastera', 'Astor Piazzolla', 'Ariel Ramírez', 'Atahualpa Yupanqui'], answer: 0, fact: 'Ginastera compuso Estancia (1941), con el famoso Malambo final.' },
      { prompt: '¿En qué ciudad vivieron Mozart, Haydn y Beethoven gran parte de su vida?', options: ['Viena', 'París', 'Londres', 'Roma'], answer: 0, fact: 'Viena fue la capital del Clasicismo musical.' },
      { prompt: '¿Cómo se llama la famosa ópera de Bizet ambientada en Sevilla?', options: ['Carmen', 'Aida', 'Tosca', 'La flauta mágica'], answer: 0, fact: 'Carmen, de Georges Bizet, se estrenó en París en 1875.' },
    ],
  },
  {
    title: 'Curiosidades de instrumentos', type: 'trivia', category: 'Instrumentos de la orquesta', icon: '🎻',
    questions: [
      { prompt: '¿Qué instrumento de fuelle es protagonista de muchos tangos?', options: ['Bandoneón', 'Flauta', 'Timbal', 'Viola'], answer: 0, fact: 'El bandoneón llegó a ser uno de los timbres más característicos del tango rioplatense.' },
      { prompt: '¿Cuántas cuerdas tiene normalmente un violín?', options: ['4', '3', '5', '6'], answer: 0, fact: 'Sus cuerdas se afinan en sol, re, la y mi, de grave a agudo.' },
      { prompt: '¿Qué instrumento de percusión puede afinarse para tocar distintas alturas?', options: ['Timbal', 'Platillo', 'Triángulo', 'Pandereta'], answer: 0, fact: 'Los timbales orquestales tienen parches afinables y pueden tocar notas definidas.' },
      { prompt: '¿A qué familia pertenece el clarinete?', options: ['Viento-madera', 'Cuerda frotada', 'Viento-metal', 'Percusión'], answer: 0, fact: 'Aunque hoy suele fabricarse de madera o plástico, el clarinete es de la familia viento-madera.' },
      { prompt: '¿Cuál es el instrumento más grave de la familia de cuerdas?', options: ['Contrabajo', 'Viola', 'Violín', 'Arpa'], answer: 0, fact: 'El contrabajo es el más grande y grave de las cuerdas frotadas.' },
      { prompt: '¿Qué instrumento afina a toda la orquesta dando la nota LA?', options: ['Oboe', 'Tuba', 'Piano', 'Platillos'], answer: 0, fact: 'El oboe da el LA porque su sonido es claro y estable.' },
      { prompt: '¿De qué material es la flauta traversa, aunque sea de viento-madera?', options: ['Metal', 'Vidrio', 'Bambú siempre', 'Cuero'], answer: 0, fact: 'La flauta moderna es de metal, pero se clasifica como viento-madera por cómo produce el sonido.' },
      { prompt: '¿Con qué se frotan las cuerdas del violín?', options: ['Con un arco de crin de caballo', 'Con una púa', 'Con baquetas', 'Con los dientes'], answer: 0, fact: 'El arco tiene crines de caballo a las que se les pone resina.' },
      { prompt: '¿Qué instrumento de metal usa una vara que se desliza?', options: ['Trombón', 'Trompeta', 'Corno francés', 'Tuba'], answer: 0, fact: 'El trombón cambia la altura alargando o acortando su vara.' },
      { prompt: '¿Cuántas teclas tiene un piano moderno?', options: ['88', '52', '64', '100'], answer: 0, fact: 'El piano moderno tiene 88 teclas: 52 blancas y 36 negras.' },
    ],
  },
  {
    title: 'Lenguaje musical', type: 'trivia', category: 'Lenguaje musical', icon: '🎼',
    questions: [
      { prompt: '¿Cuántas líneas tiene el pentagrama?', options: ['5', '4', '6', '8'], answer: 0, fact: 'Las cinco líneas y los cuatro espacios sirven para escribir alturas musicales.' },
      { prompt: '¿Qué significa staccato?', options: ['Notas cortas y separadas', 'Tocar cada vez más fuerte', 'Acelerar gradualmente', 'Sostener una nota'], answer: 0, fact: 'El punto de staccato acorta la nota y la separa de las siguientes.' },
      { prompt: '¿Cuánto duran dos corcheas en un compás simple?', options: ['Un pulso de negra', 'Dos compases', 'Cuatro pulsos', 'Una redonda'], answer: 0, fact: 'Dos corcheas equivalen a una negra: juntas ocupan un pulso.' },
      { prompt: '¿Qué indica el sostenido (♯)?', options: ['Subir la nota un semitono', 'Bajar la nota un semitono', 'Tocar más fuerte', 'Hacer una pausa'], answer: 0, fact: 'El sostenido eleva la altura de la nota en un semitono.' },
      { prompt: '¿Qué indica crescendo?', options: ['Aumentar el volumen poco a poco', 'Tocar más lento', 'Acortar todas las notas', 'Repetir desde el inicio'], answer: 0, fact: 'Crescendo significa crecer gradualmente en intensidad.' },
      { prompt: '¿Cuántos tiempos dura una redonda en 4/4?', options: ['4', '2', '1', '8'], answer: 0, fact: 'La redonda ocupa todo el compás de 4/4: cuatro tiempos.' },
      { prompt: '¿Qué indica el bemol (♭)?', options: ['Bajar la nota un semitono', 'Subir la nota un semitono', 'Tocar suave', 'Repetir'], answer: 0, fact: 'El bemol baja la altura de la nota un semitono.' },
      { prompt: '¿Qué significa piano (p) en una partitura?', options: ['Tocar suave', 'Tocar fuerte', 'Tocar rápido', 'Usar el piano'], answer: 0, fact: 'Piano indica una dinámica suave; forte (f) indica fuerte.' },
      { prompt: '¿Qué clave se usa para el violín?', options: ['Clave de sol', 'Clave de fa', 'Clave de do en 3ª', 'Clave de percusión'], answer: 0, fact: 'El violín lee en clave de sol; la viola en clave de do y el cello en clave de fa.' },
      { prompt: '¿Qué indica el número de arriba en un compás de 3/4?', options: ['Cuántos tiempos tiene el compás', 'La velocidad', 'La nota más aguda', 'Cuántos músicos tocan'], answer: 0, fact: 'En 3/4 hay tres tiempos por compás, cada uno de negra.' },
    ],
  },
  {
    title: 'Ritmos argentinos', type: 'trivia', category: 'Historia musical: folklore y tango', icon: '🇦🇷',
    questions: [
      { prompt: '¿En qué región nació el tango rioplatense?', options: ['Buenos Aires y Montevideo', 'La Patagonia y Tierra del Fuego', 'La selva misionera', 'Los Andes centrales'], answer: 0, fact: 'El tango se desarrolló en la región del Río de la Plata, especialmente en Buenos Aires y Montevideo.' },
      { prompt: '¿Qué instrumento es una de las voces emblemáticas del tango?', options: ['Bandoneón', 'Oboe', 'Timbal', 'Flauta dulce'], answer: 0, fact: 'El bandoneón llegó desde Europa y se volvió protagonista del tango rioplatense.' },
      { prompt: '¿Quién compuso Libertango y Adiós Nonino?', options: ['Astor Piazzolla', 'Carlos Gardel', 'Aníbal Troilo', 'Juan D’Arienzo'], answer: 0, fact: 'Piazzolla renovó el tango con armonías y ritmos nuevos, conservando su raíz rioplatense.' },
      { prompt: '¿Qué danza folklórica argentina suele bailarse con pañuelo?', options: ['Zamba', 'Vals vienés', 'Polca rusa', 'Jota aragonesa'], answer: 0, fact: 'En la zamba, las parejas suelen bailar con pañuelos y un juego de encuentro y cortejo.' },
      { prompt: '¿De qué provincia es especialmente representativa la chacarera?', options: ['Santiago del Estero', 'Buenos Aires únicamente', 'Tierra del Fuego', 'La Pampa únicamente'], answer: 0, fact: 'Santiago del Estero es uno de los grandes centros históricos de la chacarera.' },
      { prompt: '¿Qué instrumento marca muchos ritmos folklóricos del noroeste argentino?', options: ['Bombo legüero', 'Bandoneón', 'Trombón', 'Arpa celta'], answer: 0, fact: 'El bombo legüero es un instrumento de percusión muy presente en chacareras y otras músicas folklóricas.' },
      { prompt: '¿Qué danza folklórica se caracteriza por el zapateo vigoroso del bailarín?', options: ['Malambo', 'Zamba', 'Tango canción', 'Vals criollo'], answer: 0, fact: 'El malambo es una danza tradicional de destreza rítmica, especialmente centrada en el zapateo.' },
      { prompt: '¿Qué ritmo del litoral argentino suele acompañarse con acordeón y guitarra?', options: ['Chamamé', 'Malambo', 'Milonga ciudadana', 'Cueca cuyana'], answer: 0, fact: 'El chamamé es una música y danza muy arraigada en Corrientes y el litoral.' },
      { prompt: '¿Cómo se llama la reunión donde se canta y baila folklore?', options: ['Peña', 'Foso', 'Camerino', 'Obertura'], answer: 0, fact: 'Las peñas son espacios de encuentro para compartir música, danza y tradiciones folklóricas.' },
      { prompt: '¿Qué obra de Gerardo Matos Rodríguez se hizo famosa en todo el mundo?', options: ['La cumparsita', 'Adiós Nonino', 'La chacarera del rancho', 'Alfonsina y el mar'], answer: 0, fact: 'La cumparsita, compuesta en 1916, es uno de los tangos más conocidos internacionalmente.' },
      { prompt: '¿Qué cantante y compositor argentino fue conocido como “el Zorzal criollo”?', options: ['Carlos Gardel', 'Atahualpa Yupanqui', 'Mercedes Sosa', 'Ariel Ramírez'], answer: 0, fact: 'Carlos Gardel fue una figura fundamental en la difusión del tango canción.' },
      { prompt: '¿Qué género folklórico del noroeste se baila en ronda y tiene raíces andinas?', options: ['Carnavalito', 'Milonga porteña', 'Tango salón', 'Candombe uruguayo'], answer: 0, fact: 'El carnavalito es una música y danza colectiva del noroeste argentino, vinculada a la tradición andina.' },
      { prompt: '¿Qué ritmo suele compartir con el tango el compás de 2/4 y un carácter urbano rioplatense?', options: ['Milonga', 'Huayno', 'Malambo', 'Chamamé'], answer: 0, fact: 'La milonga rioplatense comparte raíces con el tango y suele sentirse en un pulso ágil.' },
      { prompt: '¿Qué folclorista argentino escribió “Los ejes de mi carreta”?', options: ['Atahualpa Yupanqui', 'Astor Piazzolla', 'Juan D’Arienzo', 'Carlos Guastavino'], answer: 0, fact: 'Atahualpa Yupanqui fue cantor, guitarrista y compositor fundamental del folklore argentino.' },
    ],
  },
  {
    title: 'Lenguaje: arpegio DO–MI–SOL–DO', type: 'melody', category: 'Lectura y alturas', beats: 4, icon: '📈',
    intro: 'Leé el arpegio ascendente DO₄, MI₄, SOL₄ y DO₅. Las notas aparecen en su lugar correcto en el pentagrama: escuchá y repetí el eco.',
    staffSteps: [3, 2, 1, -0.5], ledgerNotes: [0],
    patterns: [[0, 1, 2, 3], [3, 2, 1, 0], [0, 2, 1, 3]],
  },
];
const NOTE_NAMES = ['DO₄', 'MI₄', 'SOL₄', 'DO₅'];
const NOTE_COLORS = ['#ff4d8d', '#3dd6ff', '#5cf28a', '#ffb02e'];
let lesson = null;
let selectedGuideInstrument = -1;

function startLesson(i) {
  const def = LESSONS[i];
  const questions = def.questions ? def.questions.map((question) => {
    const options = shuffled(question.options.map((label, index) => ({ label, correct: index === question.answer })));
    return { ...question, options: options.map((option) => option.label), answer: options.findIndex((option) => option.correct) };
  }) : null;
  const questionOrder = questions ? shuffled(questions.map((_, index) => index)) : null;
  lesson = { def, questions, idx: i, round: 0, questionOrder, correct: 0, selectedAnswer: -1, answerCorrect: null, phase: def.type === 'trivia' ? 'trivia-question' : 'intro', clock: 0, ev: 0, taps: [], lit: -1, litT: 0, msg: '', turnClock: 0, award: null };
  music.pause();
  startCountdown(() => { scene = 'clase-play'; }, def.type === 'trivia' ? '¡Sebastián te pregunta!' : '¡Sebastián te enseña!');
}

function answerTriviaLesson(index) {
  if (!lesson || lesson.def.type !== 'trivia' || lesson.phase !== 'trivia-question') return;
  const question = lesson.questions[lesson.questionOrder[lesson.round]];
  const correct = index === question.answer;
  lesson.selectedAnswer = index;
  lesson.answerCorrect = correct;
  if (correct) {
    lesson.correct++;
    playCorrectJingle();
    lesson.msg = '¡Correcto!';
  } else {
    miss(W / 2, H * 0.5, '¡Buen intento!');
    lesson.msg = `La respuesta era: ${question.options[question.answer]}.`;
  }
  lesson.phase = 'trivia-feedback';
}


function spawnHitStars(x, y) {
  for (let i = 0; i < 9; i++) {
    const angle = (Math.PI * 2 * i) / 9;
    const speed = (55 + Math.random() * 75) * U;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 25 * U, life: 0.9, c: ['#ffe14d', '#fff6ad', '#ff8bd1'][i % 3], star: true, size: (4 + Math.random() * 4) * U });
  }
}

function drawStarShape(x, y, radius, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? radius * 0.43 : radius;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function lessonEvents() {
  const p = lesson.def.patterns[lesson.round];
  if (lesson.def.type === 'rhythm' || lesson.def.type === 'tango') return p.map((b) => ({ at: b * lesson.def.beat, v: 0 }));
  return p.map((n, i) => ({ at: i * 0.55, v: n }));
}

function playLessonDemo() {
  lesson.phase = 'demo';
  lesson.clock = -0.4;
  lesson.ev = 0;
  lesson.taps = [];
}

function lessonSound(v) {
  if (lesson.def.type === 'rhythm') playExampleClick(v === 0);
  else if (lesson.def.type === 'tango') playTone(INSTRUMENTS.find((inst) => inst.name === 'Bandoneón'), 0.28);
  else playExampleNote(v);
  lesson.lit = v;
  lesson.litT = 0.3;
}

function updateLesson(dt) {
  if (!lesson) return;
  lesson.litT -= dt;
  if (lesson.litT <= 0) lesson.lit = -1;
  if (lesson.phase === 'demo') {
    lesson.clock += dt;
    const evs = lessonEvents();
    while (lesson.ev < evs.length && evs[lesson.ev].at <= lesson.clock) lessonSound(evs[lesson.ev++].v);
    if (lesson.clock > evs[evs.length - 1].at + 0.7) {
      lesson.phase = 'turn';
      lesson.turnClock = 0;
      lesson.taps = [];
    }
  } else if (lesson.phase === 'turn') {
    lesson.turnClock += dt;
    const lastTap = lesson.taps.length ? lesson.taps[lesson.taps.length - 1].t : 0;
    if ((lesson.taps.length && lesson.turnClock - lastTap > 2.4) || (!lesson.taps.length && lesson.turnClock > 9)) evaluateLesson();
  }
}

function lessonTap(v) {
  if (!lesson || lesson.phase !== 'turn') return;
  lessonSound(v);
  lesson.taps.push({ t: lesson.turnClock, v });
  if (lesson.taps.length >= lesson.def.patterns[lesson.round].length) evaluateLesson();
}

function evaluateLesson() {
  const p = lesson.def.patterns[lesson.round];
  const taps = lesson.taps;
  let ok = taps.length === p.length;
  if (ok && (lesson.def.type === 'rhythm' || lesson.def.type === 'tango')) {
    const tol = lesson.def.beat * 0.36;
    ok = taps.every((tap, i) => Math.abs((tap.t - taps[0].t) - (p[i] - p[0]) * lesson.def.beat) < tol);
  } else if (ok) {
    ok = taps.every((tap, i) => tap.v === p[i]);
  }
  if (ok) {
    lesson.correct++;
    reward(W / 2, H * 0.42, 100, '¡Eco perfecto!');
    playCorrectJingle();
    lesson.msg = '¡Excelente! Lo repetiste igual que el ejemplo.';
  } else {
    combo = 0;
    miss(W / 2, H * 0.42, '¡Casi!');
    lesson.msg = lesson.def.type === 'rhythm' || lesson.def.type === 'tango'
      ? (taps.length !== p.length ? `Eran ${p.length} sonidos y tocaste ${taps.length}. ¡Contá con el pulso!` : 'Los sonidos estaban, pero cuidá el espacio entre ellos.')
      : `La melodía era: ${p.map((n) => NOTE_NAMES[n]).join(' – ')}`;
  }
  lesson.phase = 'feedback';
}

function nextLessonRound() {
  const total = lesson.def.type === 'trivia' ? lesson.questions.length : lesson.def.patterns.length;
  lesson.round++;
  if (lesson.round >= total) {
    lesson.phase = 'done';
    lesson.award = addTotal(lesson.correct * 100);
    if (lesson.correct === total) playSfx(sfxClap);
  } else if (lesson.def.type === 'trivia') {
    lesson.phase = 'trivia-question';
    lesson.selectedAnswer = -1;
  } else playLessonDemo();
}

function lanesX(i) {
  return W * (0.2 + i * 0.2);
}

function update(dt) {
  time += dt;
  particles.forEach((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 300 * dt;
    p.life -= dt * 1.4;
  });
  particles = particles.filter((p) => p.life > 0);
  popups.forEach((p) => {
    p.y -= 40 * dt;
    p.life -= dt;
  });
  popups = popups.filter((p) => p.life > 0);
  if (scene === 'credits') {
    creditsElapsed = Math.min(CREDITS_END, creditsElapsed + dt);
    return;
  }
  if (scene === 'intro') {
    welcomeState.elapsed += dt;
    welcomeState.slideElapsed += dt;
    return;
  }
  if (scene === 'orchestra-invite') {
    invitationElapsed += dt;
    invitationConfetti.forEach((piece) => {
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.vy += 22 * dt;
      piece.rotation += piece.spin * dt;
      piece.life -= dt;
    });
    invitationConfetti = invitationConfetti.filter((piece) => piece.life > 0 && piece.y < H + 20 * U);
    return;
  }
  if (scene === 'salieri-runner') {
    if (!isMobilePortrait()) {
      salieriRunner.update(dt, W, H);
      handleSalieriRunnerEvents();
    }
    return;
  }
  if (scene === 'salieri-ranking') return;
  if (scene === 'countdown') {
    if (!countdownState) return;
    countdownState.elapsed += dt;
    if (countdownState.elapsed >= 1) {
      countdownState.elapsed -= 1;
      countdownState.value--;
      if (countdownState.value <= 0) {
        const complete = countdownState.onComplete;
        countdownState = null;
        complete?.();
      }
    }
    return;
  }
  if (scene === 'clase-play') updateLesson(dt);
  if (st.quiz) advanceRoscoSpin(st, dt);
  if (duel) advanceRoscoSpin(duel, dt);
  if (scene !== 'play') return;
  st.t += dt;
  if (st.quiz || duel) {
    updateQuiz(dt);
    return;
  }

  if (game.key === 'dirigir') {
    updateConductor(dt);
    if (st.t >= st.duration) endGame();
  } else if (game.key === 'reconocer') {
    st.qTime += dt;
    if (st.answered >= 0 && st.qTime > 5.5) nextQuestion();
  } else if (game.key === 'ritmo') {
    st.level = 1 + Math.floor(st.t / (selectedDifficulty === 'dificil' ? 9 : 12));
    st.spawn -= dt;
    const difficulty = DIFFICULTIES[selectedDifficulty];
    const speed = H * (0.24 + st.level * 0.032) * difficulty.rhythmSpeed;
    if (st.spawn <= 0) {
      const lane = Math.floor(Math.random() * 4);
      st.notes.push({ lane, y: -30 });
      if (st.level >= difficulty.doubleFrom && Math.random() < Math.min(0.38, 0.1 + (st.level - difficulty.doubleFrom) * 0.035)) {
        let secondLane = Math.floor(Math.random() * 3);
        if (secondLane >= lane) secondLane++;
        st.notes.push({ lane: secondLane, y: -30 });
        if (selectedDifficulty === 'dificil' && st.level >= 6 && Math.random() < Math.min(0.22, 0.04 + (st.level - 6) * 0.025)) {
          const thirdLane = [0, 1, 2, 3].find((candidate) => candidate !== lane && candidate !== secondLane);
          st.notes.push({ lane: thirdLane, y: -30 });
          if (st.level >= 10 && Math.random() < Math.min(0.1, 0.03 + (st.level - 10) * 0.015)) {
            const fourthLane = [0, 1, 2, 3].find((candidate) => candidate !== lane && candidate !== secondLane && candidate !== thirdLane);
            st.notes.push({ lane: fourthLane, y: -30 });
          }
        }
      }
      st.spawned++;
      st.spawn = Math.max(selectedDifficulty === 'dificil' ? 0.48 : 0.62, 1.32 - st.level * 0.065) * difficulty.rhythmSpawn;
    }
    st.notes.forEach((n) => {
      n.y += speed * dt;
    });
    const lineY = H * 0.75;
    st.notes = st.notes.filter((n) => {
      if (n.y > lineY + 60 * U) {
        st.lives--;
        miss(lanesX(n.lane), lineY);
        return false;
      }
      return true;
    });
    if (st.lives <= 0) endGame();
  } else if (game.key === 'sinfonico') {
    if (st.phase === 'preview') {
      st.playClock += dt;
      while (st.eventIndex < st.question.events.length && st.question.events[st.eventIndex].at <= st.playClock) {
        const event = st.question.events[st.eventIndex++];
        st.lit = st.eventIndex - 1;
        st.litT = event.duration;
        if (event.kind === 'rhythm') playExampleClick(event.beat === 0);
        else if (event.kind === 'melody') playExampleFrequency(700 * event.rate, event.duration);
        else if (event.instrument) playTone(event.instrument, event.duration, event.rate);
      }
      if (st.playClock >= st.question.duration) {
        st.phase = 'answer';
        st.lit = -1;
      }
    } else if (st.phase === 'feedback') {
      st.feedbackTimer += dt;
      if (st.feedbackTimer >= 5.2) {
        if (st.questionIndex < st.questionsPerEpisode - 1) {
          st.questionIndex++;
          loadSymphonyQuestion();
        } else {
          st.phase = 'episode-clear';
        }
      }
    }
  }
}

function hitRhythmLane(lane) {
  if (scene !== 'play' || game.key !== 'ritmo') return;
  const lineY = H * 0.75;
  let hit = null;
  const hitWindow = DIFFICULTIES[selectedDifficulty].rhythmHitWindow * U;
  st.notes.forEach((note) => {
    if (note.lane === lane && Math.abs(note.y - lineY) < hitWindow && (!hit || Math.abs(note.y - lineY) < Math.abs(hit.y - lineY))) hit = note;
  });
  if (!hit) {
    combo = 0;
    return;
  }
  st.notes.splice(st.notes.indexOf(hit), 1);
  const perfect = Math.abs(hit.y - lineY) < 20 * U;
  const hitX = lanesX(lane);
  playMetalNote(lane);
  reward(hitX, lineY - 30, perfect ? 50 : 25, perfect ? '¡Perfecto!' : '¡Bien!');
  spawnHitStars(hitX, lineY - 24 * U);
}

// ---------- Input ----------
function playUiTap() {
  if (muted || !actx || actx.state !== 'running') return;
  try {
    const oscillator = actx.createOscillator();
    const gain = actx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(680, actx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(920, actx.currentTime + 0.055);
    gain.gain.setValueAtTime(0.045, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.07);
    oscillator.connect(gain);
    gain.connect(actx.destination);
    oscillator.start();
    oscillator.stop(actx.currentTime + 0.075);
  } catch (error) { /* El sonido de interfaz es opcional. */ }
}

function onTap(x, y) {
  if (isMobileLandscape() && !runnerLayout && scene !== 'intro' && scene !== 'orchestra-invite' && scene !== 'orchestra-info' && scene !== 'credits') return;
  for (const b of buttons) {
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) {
      playUiTap();
      b.fn();
      return;
    }
  }
  if (scene === 'intro') {
    playUiTap();
    advanceWelcome();
    return;
  }
  if (scene === 'salieri-runner') {
    if (y >= H * 0.29) salieriRunner.jump();
    return;
  }
  if (scene === 'salieri-ranking') return;
  if (scene !== 'play') return;
  if (game.key === 'reconocer' && st.answered < 0) {
    st.options.forEach((o, i) => {
      const r = optionRect(i);
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) {
        st.answered = i;
        st.qTime = 0;
        const correct = o === st.answer;
        st.feedback = `${st.answer.name} · ${st.answer.family}: ${st.answer.clue}`;
        if (correct) {
          playCorrectJingle();
          reward(r.x + r.w / 2, r.y, 100, '¡Correcto!');
        } else {
          miss(r.x + r.w / 2, r.y, 'Era ' + st.answer.name);
          playTone(st.answer, 1.3);
        }
      }
    });
  } else if (game.key === 'ritmo') {
    const lane = Math.max(0, Math.min(3, Math.round((x / W - 0.2) / 0.2)));
    hitRhythmLane(lane);
  } else if (game.key === 'sinfonico' && st.phase === 'answer') {
    st.question.options.forEach((option, i) => {
      const r = optionRect(i);
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) answerSymphony(i);
    });
  }
}

function canvasPointFromEvent(event) {
  return { x: event.clientX - gameViewportLeft, y: event.clientY - gameViewportTop };
}

function handleKeyboardGameAction(event) {
  const key = event.key;
  if (scene === 'credits') {
    if (key === 'Escape' || key === 'Backspace') {
      returnToMenu();
      return true;
    }
    if (!event.repeat && (key === 'Enter' || key === ' ' || key === 'ArrowRight')) {
      skipCredits();
      return true;
    }
  }
  if (scene === 'salieri-runner') {
    if (salieriRunner.allyDialogOpen) {
      if (event.code === 'Space' || key === 'Enter' || key === 'Escape') salieriRunner.closeAllyDialog();
      return true;
    }
    if (event.code === 'Space' || key === 'ArrowUp' || key === 'w' || key === 'W') {
      if (!event.repeat) salieriRunner.jump();
      return true;
    }
    if (key.toLowerCase() === 'p' || key === 'Escape') {
      salieriRunner.togglePause();
      return true;
    }
  }
  if (scene === 'salieri-ranking' && (key === 'Escape' || key === 'Backspace')) {
    scene = 'salieri-runner';
    return true;
  }
  const choiceIndex = /^[1-4]$/.test(key) ? Number(key) - 1 : -1;
  if (scene === 'play') {
    if (key === 'Escape') {
      returnToMenu();
      return true;
    }
    if (game?.key === 'dirigir' && (event.code === 'Space' || key === 'Enter')) {
      keyboardConductorHeld = true;
      return true;
    }
    if (game?.key === 'ritmo') {
      const arrowLanes = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
      const lane = choiceIndex >= 0 ? choiceIndex : arrowLanes[key];
      if (lane !== undefined) {
        hitRhythmLane(lane);
        return true;
      }
    }
    if (choiceIndex >= 0 && game?.key === 'reconocer' && st.answered < 0 && choiceIndex < st.options.length) {
      const rect = optionRect(choiceIndex);
      onTap(rect.x + rect.w / 2, rect.y + rect.h / 2);
      return true;
    }
    if (choiceIndex >= 0 && duel?.phase === 'question' && duel.myAnswer === null && choiceIndex < duel.question.options.length) {
      submitDuelAnswer(choiceIndex);
      return true;
    }
    if (choiceIndex >= 0 && st.quiz && st.phase === 'question' && choiceIndex < st.question.options.length) {
      answerSoloQuiz(choiceIndex);
      return true;
    }
    if (choiceIndex >= 0 && game?.key === 'sinfonico' && st.phase === 'answer' && choiceIndex < st.question.options.length) {
      answerSymphony(choiceIndex);
      return true;
    }
  }
  if (scene === 'clase-play') {
    if (event.code === 'Space' && lesson.phase === 'turn' && ['rhythm', 'tango'].includes(lesson.def.type)) {
      lessonTap(0);
      return true;
    }
    if (choiceIndex >= 0) {
      if (lesson.phase === 'trivia-question' && choiceIndex < lesson.questions[lesson.questionOrder[lesson.round]].options.length) {
        answerTriviaLesson(choiceIndex);
        return true;
      }
      if (lesson.phase === 'history-question' && choiceIndex < lesson.def.options.length) {
        answerHistoryLesson(choiceIndex);
        return true;
      }
      if (lesson.phase === 'turn' && lesson.def.patterns && choiceIndex < lesson.def.patterns[lesson.round].length) {
        lessonTap(choiceIndex);
        return true;
      }
    }
  }
  return false;
}

function stepKeyboardFocus(direction) {
  if (keyboardFocusScene !== scene) {
    keyboardFocusScene = scene;
    keyboardFocusIndex = -1;
  }
  if (!buttons.length) return;
  keyboardFocusIndex = (keyboardFocusIndex + direction + buttons.length) % buttons.length;
  canvas.focus();
}

window.addEventListener('keydown', (event) => {
  const tagName = event.target?.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || event.target?.isContentEditable) return;
  if (isMobileLandscape() && !runnerLayout && scene !== 'intro' && scene !== 'orchestra-invite' && scene !== 'orchestra-info' && scene !== 'credits') return;
  if (event.key === 'Tab') {
    event.preventDefault();
    stepKeyboardFocus(event.shiftKey ? -1 : 1);
    return;
  }
  if (scene === 'play' || scene === 'clase-play' || scene === 'intro' || scene === 'salieri-runner') unlockAudio();
  if (scene === 'intro' && ['Enter', ' ', 'ArrowRight', 'ArrowDown'].includes(event.key) && !event.repeat) {
    event.preventDefault();
    playUiTap();
    advanceWelcome();
    return;
  }
  if (scene === 'orchestra-invite' && (event.key === 'Escape' || event.key === 'Backspace')) {
    event.preventDefault();
    closeOrchestraInvitation();
    return;
  }
  if (scene === 'orchestra-info' && (event.key === 'Escape' || event.key === 'Backspace')) {
    event.preventDefault();
    closeOrchestraInfo();
    return;
  }
  if (handleKeyboardGameAction(event)) {
    event.preventDefault();
    return;
  }
  if ((event.key === 'Escape' || event.key === 'Backspace') && scene === 'intro') {
    event.preventDefault();
    leaveIntro();
    return;
  }
  if ((event.key === 'Escape' || event.key === 'Backspace') && scene !== 'menu') {
    event.preventDefault();
    returnToMenu();
    return;
  }
  if (['ArrowRight', 'ArrowDown'].includes(event.key) && scene !== 'play' && scene !== 'clase-play') {
    event.preventDefault();
    stepKeyboardFocus(1);
    return;
  }
  if (['ArrowLeft', 'ArrowUp'].includes(event.key) && scene !== 'play' && scene !== 'clase-play') {
    event.preventDefault();
    stepKeyboardFocus(-1);
    return;
  }
  if ((event.key === 'Enter' || event.code === 'Space') && !event.repeat && keyboardFocusScene === scene && keyboardFocusIndex >= 0) {
    event.preventDefault();
    const target = buttons[keyboardFocusIndex];
    if (target) {
      unlockAudio();
      playUiTap();
      target.fn();
    }
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space' || event.key === 'Enter') keyboardConductorHeld = false;
});
window.addEventListener('blur', () => {
  keyboardConductorHeld = false;
  pointer.down = false;
});

canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (isMobileLandscape() && !runnerLayout && scene !== 'intro' && scene !== 'orchestra-invite' && scene !== 'orchestra-info' && scene !== 'credits') { pointer.down = false; return; }
  const point = canvasPointFromEvent(e);
  pointer = { ...point, down: true };
  try { canvas.setPointerCapture(e.pointerId); } catch (error) { /* Algunos navegadores no lo necesitan. */ }
  if (scene === 'menu') {
    menuPointerDown = {
      x: point.x,
      y: point.y,
      lastY: point.y,
      canScroll: point.y >= menuScrollTop && point.y < menuNavTop,
      moved: false,
    };
    return;
  }
  if (scene === 'profile') {
    profilePointerDown = {
      x: point.x,
      y: point.y,
      lastY: point.y,
      canScroll: point.y >= profileScrollTop && point.y < profileScrollBottom,
      moved: false,
    };
    return;
  }
  onTap(point.x, point.y);
});
canvas.addEventListener('pointermove', (e) => {
  const point = canvasPointFromEvent(e);
  pointer.x = point.x;
  pointer.y = point.y;
  if (scene === 'menu' && menuPointerDown) {
    const dy = point.y - menuPointerDown.lastY;
    if (Math.abs(point.y - menuPointerDown.y) > 9) menuPointerDown.moved = true;
    if (menuPointerDown.canScroll && menuPointerDown.moved) {
      menuScroll = Math.max(0, Math.min(menuMaxScroll, menuScroll - dy));
    }
    menuPointerDown.lastY = point.y;
  }
  if (scene === 'profile' && profilePointerDown) {
    const dy = point.y - profilePointerDown.lastY;
    if (Math.abs(point.y - profilePointerDown.y) > 9) profilePointerDown.moved = true;
    if (profilePointerDown.canScroll && profilePointerDown.moved) {
      profileScroll = Math.max(0, Math.min(profileScrollMax, profileScroll - dy));
    }
    profilePointerDown.lastY = point.y;
  }
});
canvas.addEventListener('pointerup', () => {
  pointer.down = false;
  if (menuPointerDown) {
    const gesture = menuPointerDown;
    menuPointerDown = null;
    if (scene === 'menu' && !gesture.moved) onTap(gesture.x, gesture.y);
  }
  if (profilePointerDown) {
    const gesture = profilePointerDown;
    profilePointerDown = null;
    if (scene === 'profile' && !gesture.moved) onTap(gesture.x, gesture.y);
  }
});
canvas.addEventListener('pointercancel', () => {
  pointer.down = false;
  menuPointerDown = null;
  profilePointerDown = null;
});
canvas.addEventListener('wheel', (e) => {
  if (scene === 'menu') {
    e.preventDefault();
    menuScroll = Math.max(0, Math.min(menuMaxScroll, menuScroll + e.deltaY));
  } else if (scene === 'profile') {
    e.preventDefault();
    profileScroll = Math.max(0, Math.min(profileScrollMax, profileScroll + e.deltaY));
  }
}, { passive: false });

// ---------- Drawing ----------
function drawCover(img) {
  if (!img.complete || !img.naturalWidth) {
    ctx.fillStyle = '#2a1640';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  // Escenarios verticales a pantalla completa, con un leve movimiento de cámara.
  const sx = img.naturalWidth * 0.03;
  const sw = img.naturalWidth * 0.94;
  const sy = img.naturalHeight * 0.02;
  const sh = img.naturalHeight * 0.96;
  const swayX = Math.sin(time * 0.18) * img.naturalWidth * 0.025;
  const swayY = Math.cos(time * 0.14) * img.naturalHeight * 0.015;
  const s = Math.max(W / sw, H / sh);
  const w = sw * s;
  const h = sh * s;
  ctx.drawImage(img, sx + swayX, sy + swayY, sw, sh, (W - w) / 2, (H - h) / 2, w, h);
}

function drawMovingLights() {
  ctx.save();
  // Piso de escenario 3D en perspectiva que avanza hacia el jugador
  const horizon = H * 0.62;
  const floor = ctx.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, 'rgba(8,12,28,0)');
  floor.addColorStop(1, 'rgba(8,12,28,0.65)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, W, H - horizon);
  ctx.strokeStyle = 'rgba(77,240,255,0.13)';
  ctx.lineWidth = 1 * U;
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * W * 0.04, horizon);
    ctx.lineTo(W / 2 + i * W * 0.32, H);
    ctx.stroke();
  }
  const scroll = (time * 0.35) % 1;
  for (let j = 0; j < 9; j++) {
    const z = (j + scroll) / 9;
    const y = horizon + (H - horizon) * z * z;
    ctx.globalAlpha = z;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Reflectores fríos que barren el escenario
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 2; i++) {
    const sway = Math.sin(time * 0.5 + i * 2.4) * 0.35;
    const topX = W * (i ? 0.85 : 0.15);
    const g = ctx.createLinearGradient(topX, 0, topX, H);
    g.addColorStop(0, i ? 'rgba(255,61,127,0.16)' : 'rgba(77,240,255,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(topX - W * 0.02, -5);
    ctx.lineTo(topX + W * 0.02, -5);
    ctx.lineTo(topX + W * (sway + 0.18) * (i ? -1 : 1) + W * 0.12, H * 0.9);
    ctx.lineTo(topX + W * (sway + 0.18) * (i ? -1 : 1) - W * 0.12, H * 0.9);
    ctx.closePath(); ctx.fill();
  }
  // Partículas flotantes con profundidad
  for (let i = 0; i < 18; i++) {
    const depth = 0.3 + ((i * 37) % 10) / 14;
    const x = ((i * 97.3 + time * 12 * depth) % (W + 40)) - 20;
    const y = H * (((i * 0.137) % 1)) + Math.sin(time * depth + i) * 12 * U;
    ctx.fillStyle = `rgba(200,240,255,${0.05 + depth * 0.1})`;
    ctx.beginPath(); ctx.arc(x, y, (1 + depth * 2.5) * U, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawFitSway(cx) {
  return Math.sin(time * 2.1 + cx * 0.01) * 0.018;
}

function drawFit(img, cx, by, h, bob = 0) {
  if (!img.complete || !img.naturalWidth) return;
  const w = (img.naturalWidth / img.naturalHeight) * h;
  const sway = drawFitSway(cx);
  ctx.save();
  ctx.translate(cx, by - h / 2 + bob);
  ctx.rotate(sway);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// Títulos de sección con volumen 3D y la tipografía de la identidad del juego.
// Traduce y, si la traducción es más ancha que el original, reduce la letra para ocupar el mismo ancho.
const preFittedLabels = new Set(); // textos ya medidos en su idioma por menuFitSize (no se reducen dos veces)
function localizedFit(str, size, fontFor) {
  const translated = t(str);
  if (translated === str || preFittedLabels.has(translated)) return { str: translated, size };
  ctx.font = fontFor(size);
  const originalW = ctx.measureText(str).width;
  const translatedW = ctx.measureText(translated).width;
  return { str: translated, size: translatedW > originalW && translatedW > 0 ? size * originalW / translatedW : size };
}

function title(str, x, y, size, color = '#ffe14d') {
  size *= 1.25;
  ({ str, size } = localizedFit(str, size, (s) => `${s * U}px ${TITLE_FONT}`));
  ctx.font = `${size * U}px ${TITLE_FONT}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const depth = Math.max(2, Math.round(size / 7));
  for (let d = depth; d > 0; d--) {
    ctx.fillStyle = d === depth ? 'rgba(0,0,0,0.55)' : '#121628';
    ctx.fillText(str, x + d * 0.5 * U, y + d * U);
  }
  const g = ctx.createLinearGradient(0, y - size * U, 0, y);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillText(str, x, y);
}

function panel(x, y, w, h, alpha = 0.62) {
  ctx.fillStyle = `rgba(0,0,0,${alpha * 0.5})`;
  ctx.beginPath();
  ctx.roundRect(x + 3 * U, y + 6 * U, w, h, 14 * U);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(30,36,62,${Math.min(1, alpha + 0.15)})`);
  g.addColorStop(1, `rgba(10,13,28,${Math.min(1, alpha + 0.2)})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14 * U);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5 * U;
  ctx.stroke();
  ctx.fillStyle = 'rgba(77,240,255,0.7)';
  ctx.fillRect(x + 14 * U, y, Math.min(60 * U, w * 0.3), 2 * U);
}

function text(str, x, y, size, color = '#fff', align = 'center') {
  if (typeof str === 'string') ({ str, size } = localizedFit(str, size, (s) => `800 ${s * U}px ${FONT}`));
  ctx.font = `800 ${size * U}px ${FONT}`;
  ctx.textAlign = align;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4 * U;
  ctx.strokeStyle = 'rgba(20,0,40,0.75)';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function wrappedText(str, x, y, maxWidth, lineHeight, size, color = '#fff') {
  str = t(String(str));
  ctx.font = `800 ${size * U}px ${FONT}`;
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((part, i) => text(part, x, y + i * lineHeight * U, size, color));
}

function button(label, x, y, w, h, fn, color = '#ff3d7f', size = 19) {
  const hitW = Math.max(w, 48);
  const hitH = Math.max(h, 48);
  const hitX = Math.max(0, Math.min(W - hitW, x - (hitW - w) / 2));
  const hitY = Math.max(0, Math.min(H - hitH, y - (hitH - h) / 2));
  buttons.push({ x: hitX, y: hitY, w: hitW, h: hitH, fn });
  // Botón con volumen 3D: sombra, canto extruido y cara superior.
  const r = Math.min(h / 2, 12 * U);
  const depth = 6 * U;
  const hovered = pointer.down && pointer.x > x && pointer.x < x + w && pointer.y > y && pointer.y < y + h;
  const press = hovered ? depth * 0.7 : 0;
  const faceColor = muteButtonColor(color);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(x + 2 * U, y + depth + 5 * U, w, h, r);
  ctx.fill();
  ctx.fillStyle = shade(shade(faceColor));
  ctx.beginPath();
  ctx.roundRect(x, y + depth, w, h, r);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y + press, 0, y + press + h);
  g.addColorStop(0, lighten(faceColor));
  g.addColorStop(0.5, faceColor);
  g.addColorStop(1, shade(faceColor));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y + press, w, h, r);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.roundRect(x + 3 * U, y + press + 2 * U, w - 6 * U, h * 0.38, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.2 * U;
  ctx.beginPath();
  ctx.roundRect(x, y + press, w, h, r);
  ctx.stroke();
  text(label, x + w / 2, y + press + h / 2 + size * 0.36 * U, size);
}

function lighten(hex) {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.min(255, Math.floor(v + (255 - v) * 0.3)).toString(16).padStart(2, '0');
  return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
}

function muteButtonColor(hex) {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16; const g = (n >> 8) & 255; const b = n & 255;
  const mix = (channel, base) => Math.round(channel * 0.42 + base * 0.58).toString(16).padStart(2, '0');
  return '#' + mix(r, 42) + mix(g, 57) + mix(b, 75);
}

function shade(hex) {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.floor(v * 0.6)).toString(16).padStart(2, '0');
  return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
}

function avatarBadge(index, cx, cy, size) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.clip();
  const safeIndex = ((Number(index) || 0) % AVATARS.length + AVATARS.length) % AVATARS.length;
  const img = AVATARS[safeIndex === AVATARS.length - 1 ? 0 : safeIndex].img;
  if (img.complete && img.naturalWidth) {
    const h = size * 1.9;
    const w = (img.naturalWidth / img.naturalHeight) * h;
    ctx.drawImage(img, cx - w / 2, cy - size * 0.45, w, h);
  }
  ctx.restore();
  ctx.strokeStyle = '#ffe14d';
  ctx.lineWidth = 2 * U;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.stroke();
}

function drawStagePicker(y) {
  if (!isStageUnlocked(selectedStage)) selectedStage = 0;
  text('🎭 Elegí el escenario (3 libres · desbloqueá los demás ganando)', W / 2, y, 12, '#7ff0ff');
  const cols = 4;
  const gapX = W * 0.018;
  const gapY = H * 0.012;
  const w = (W * 0.9 - gapX * (cols - 1)) / cols;
  const h = H * 0.061;
  STAGES.forEach((stage, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = W * 0.05 + col * (w + gapX);
    const yy = y + 8 * U + row * (h + gapY);
    const unlocked = isStageUnlocked(i);
    buttons.push({
      x, y: yy, w, h,
      fn: () => {
        if (!unlocked) {
          const req = STAGE_UNLOCKS[i];
          popups.push({ x: W / 2, y: H * 0.45, text: `🔒 Bloqueado: necesitás ${req.label}`, color: '#FFD52B', life: 2.2 });
          if (navigator.vibrate) navigator.vibrate(40);
          return;
        }
        selectedStage = i;
      }
    });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, yy, w, h, 10 * U);
    ctx.clip();
    if (stage.img.complete && stage.img.naturalWidth) {
      const sh = stage.img.naturalWidth * (h / w);
      ctx.drawImage(stage.img, 0, (stage.img.naturalHeight - sh) * 0.34, stage.img.naturalWidth, sh, x, yy, w, h);
    }
    if (!unlocked) {
      ctx.fillStyle = 'rgba(7,9,24,0.78)';
      ctx.fillRect(x, yy, w, h);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x, yy + h * 0.55, w, h * 0.45);
    }
    ctx.restore();

    ctx.strokeStyle = !unlocked ? 'rgba(255,255,255,0.2)' : selectedStage === i ? '#ffe14d' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = (selectedStage === i && unlocked ? 3 : 1.5) * U;
    ctx.beginPath();
    ctx.roundRect(x, yy, w, h, 10 * U);
    ctx.stroke();

    if (!unlocked) {
      text('🔒', x + w / 2, yy + h * 0.38, 12);
      wrappedText(STAGE_UNLOCKS[i].label, x + w / 2, yy + h * 0.72, w * 0.92, 9, 7.2, '#FFD52B');
    } else {
      wrappedText(stage.name, x + w / 2, yy + h * 0.68, w * 0.9, 11, 8.5, '#fff');
    }
  });
}

function optionRect(i) {
  const w = W * 0.42;
  const h = H * 0.17;
  return { x: W * 0.05 + (i % 2) * W * 0.48, y: H * 0.42 + Math.floor(i / 2) * (h + H * 0.03), w, h };
}

function gridRect(i) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const gap = W * 0.018;
  const w = (W * 0.9 - gap * 2) / 3;
  const h = Math.min(H * 0.095, (H * 0.43 - gap * 3) / 4);
  return { x: W * 0.05 + col * (w + gap), y: H * 0.43 + row * (h + gap), w, h };
}

function drawIconCard(r, inst, highlight, label, compact = false) {
  ctx.fillStyle = highlight || 'rgba(255,248,230,0.94)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 14 * U);
  ctx.fill();
  const drawSize = Math.min(r.w * (compact ? 0.6 : 0.78), r.h * (compact ? 0.66 : 0.78));
  if (inst.img.complete && inst.img.naturalWidth) {
    const ratio = Math.min(drawSize / inst.img.naturalWidth, drawSize / inst.img.naturalHeight);
    const imageW = inst.img.naturalWidth * ratio;
    const imageH = inst.img.naturalHeight * ratio;
    const imageY = compact ? r.y + 2 * U : r.y + 3 * U;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(inst.img, r.x + (r.w - imageW) / 2, imageY, imageW, imageH);
  }
  if (label) text(inst.name, r.x + r.w / 2, r.y + r.h - (compact ? 4 : 8) * U, compact ? 11 : 16);
}

const MENU_COLORS = {
  navy: '#11132B',
  blue: '#1269F3',
  violet: '#8B20F5',
  cyan: '#00DFFF',
  pink: '#FF28CC',
  yellow: '#FFD52B',
};

function drawNeonPanel(x, y, w, h, accent, fillTop = 'rgba(34,29,83,0.98)', fillBottom = 'rgba(14,16,49,0.98)') {
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12 * U;
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, fillTop);
  gradient.addColorStop(1, fillBottom);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 17 * U);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.2 * U;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1 * U;
  ctx.beginPath();
  ctx.roundRect(x + 4 * U, y + 4 * U, w - 8 * U, h - 8 * U, 13 * U);
  ctx.stroke();
  ctx.restore();
}

function addClippedMenuHit(x, y, w, h, fn) {
  const hitW = Math.max(w, 48);
  const hitH = Math.max(h, 48);
  const hitX = Math.max(0, Math.min(W - hitW, x - (hitW - w) / 2));
  const hitY = y - (hitH - h) / 2;
  const top = Math.max(hitY, menuScrollTop);
  const bottom = Math.min(hitY + hitH, menuNavTop);
  if (bottom > top) buttons.push({ x: hitX, y: top, w: hitW, h: bottom - top, fn });
}

function drawMenuAction(label, x, y, w, h, fn, color, size = 12) {
  if (y + h <= menuScrollTop || y >= menuNavTop) return;
  const before = buttons.length;
  button(label, x, y, w, h, fn, color, size);
  buttons.splice(before);
  addClippedMenuHit(x, y, w, h, fn);
}

function drawMenuBackdrop(showConcertStage = false) {
  if (showConcertStage) {
    drawCover(STAGES[selectedStage].img);
    ctx.fillStyle = 'rgba(6,9,31,0.70)';
    ctx.fillRect(0, 0, W, H);
    drawMovingLights();
  } else {
    const bg = ctx.createLinearGradient(0, 0, W * 0.82, H);
    bg.addColorStop(0, '#171244');
    bg.addColorStop(0.48, '#11132B');
    bg.addColorStop(1, '#080D28');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }
  const glow = (x, y, radius, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(17,19,43,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  glow(W * 0.12, H * 0.22, W * 0.45, 'rgba(139,32,245,0.19)');
  glow(W * 0.85, H * 0.4, W * 0.42, 'rgba(18,105,243,0.17)');
  for (let i = 0; i < 12; i++) {
    const x = ((i * 83 + time * (7 + i % 3)) % (W + 24)) - 12;
    const y = ((i * 127 + time * (4 + i % 4)) % H);
    ctx.globalAlpha = 0.22 + (i % 3) * 0.12;
    text(i % 2 ? '♪' : '♫', x, y, 8 + (i % 3) * 2, i % 2 ? '#00DFFF' : '#FF28CC');
  }
  ctx.globalAlpha = 1;
}

function drawMenuTrebleClef(cx, cy, size) {
  ctx.save();
  ctx.strokeStyle = '#FFD52B';
  ctx.lineWidth = 3.3 * U;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = '#FFD52B';
  ctx.shadowBlur = 9 * U;
  ctx.beginPath();
  ctx.moveTo(cx + size * 0.08, cy + size * 0.38);
  ctx.bezierCurveTo(cx - size * 0.15, cy + size * 0.26, cx - size * 0.12, cy + size * 0.05, cx, cy - size * 0.06);
  ctx.bezierCurveTo(cx + size * 0.19, cy - size * 0.22, cx + size * 0.06, cy - size * 0.36, cx - size * 0.02, cy - size * 0.32);
  ctx.bezierCurveTo(cx - size * 0.15, cy - size * 0.27, cx - size * 0.07, cy - size * 0.13, cx + size * 0.07, cy - size * 0.08);
  ctx.bezierCurveTo(cx + size * 0.34, cy + size * 0.01, cx + size * 0.25, cy + size * 0.25, cx + size * 0.02, cy + size * 0.3);
  ctx.bezierCurveTo(cx - size * 0.2, cy + size * 0.36, cx + size * 0.03, cy + size * 0.53, cx + size * 0.2, cy + size * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + size * 0.18, cy + size * 0.43);
  ctx.bezierCurveTo(cx + size * 0.12, cy + size * 0.16, cx + size * 0.14, cy - size * 0.19, cx + size * 0.2, cy - size * 0.46);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.02, cy + size * 0.29, size * 0.1, size * 0.075, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSchoolLogoKeyed(x, y, w, h, vivid = false, onWhite = false) {
  if (!SCHOOL_LOGO.complete || !SCHOOL_LOGO.naturalWidth) return;
  ctx.save();
  if (onWhite) {
    if (vivid) ctx.filter = 'saturate(2.8) contrast(1.24) brightness(1.02)';
    ctx.drawImage(SCHOOL_LOGO, x, y, w, h);
  } else {
    ctx.globalCompositeOperation = 'screen';
    if (vivid) ctx.filter = 'saturate(2.2) brightness(1.15)';
    ctx.drawImage(SCHOOL_LOGO, x, y, w, h);
  }
  ctx.restore();
}

function drawMenuHeader() {
  const logoX = W * 0.04;
  const logoY = 8 * U;
  const logoW = W * 0.25;
  const logoH = logoW * 771 / 1536;
  drawSchoolLogoKeyed(logoX, logoY, logoW, logoH);
  const brandX = W * 0.685;
  const brandW = W * 0.56;
  const clefSize = Math.min(H * 0.075, 58 * U);
  drawMenuTrebleClef(W * 0.355, logoY + logoH * 0.62, clefSize);
  animatedTitle('ORQUESTA', brandX, H * 0.058, 19, '#FFD52B', brandW);
  animatedTitle('ESCUELA', brandX, H * 0.101, 19, '#00DFFF', brandW);
  const soundSize = Math.min(38 * U, W * 0.1);
  const sx = W - soundSize - 9 * U;
  const sy = logoY;
  const soundHit = Math.max(soundSize, 48);
  buttons.push({
    x: Math.max(0, Math.min(W - soundHit, sx - (soundHit - soundSize) / 2)),
    y: Math.max(0, sy - (soundHit - soundSize) / 2),
    w: soundHit,
    h: soundHit,
    fn: toggleMute,
  });
  ctx.save();
  ctx.shadowColor = MENU_COLORS.cyan;
  ctx.shadowBlur = 9 * U;
  ctx.fillStyle = 'rgba(14,20,65,0.96)';
  ctx.beginPath(); ctx.roundRect(sx, sy, soundSize, soundSize, 12 * U); ctx.fill();
  ctx.strokeStyle = MENU_COLORS.cyan; ctx.lineWidth = 1.8 * U; ctx.stroke();
  ctx.restore();
  text(muted ? '🔇' : '🔊', sx + soundSize / 2, sy + soundSize * 0.68, 17);
}

function drawMenuOrchestra() {
  const centers = [0.11, 0.266, 0.422, 0.578, 0.734, 0.89];
  const heights = [0.145, 0.142, 0.137, 0.142, 0.14, 0.145];
  const floorY = H * 0.3;
  MENU_MASCOTS.forEach((mascot, i) => {
    const h = H * heights[i];
    const bob = Math.sin(time * 2.3 + i * 0.78) * 2.4 * U;
    drawFit(mascot, W * centers[i], floorY, h, bob);
  });
  for (let i = 0; i < 5; i++) {
    const x = W * (0.17 + i * 0.165) + Math.sin(time * 1.5 + i) * 4 * U;
    const y = H * (0.19 + (i % 2) * 0.045) + Math.cos(time * 1.7 + i) * 3 * U;
    text(i % 2 ? '♪' : '♫', x, y, 13, i % 2 ? '#FFD52B' : '#00DFFF');
  }
}

function drawMenuProfileCard() {
  const x = W * 0.04;
  const y = H * 0.305;
  const w = W * 0.92;
  const h = H * 0.113;
  drawNeonPanel(x, y, w, h, '#FF28CC', 'rgba(31,15,82,0.98)', 'rgba(7,21,58,0.98)');
  buttons.push({ x, y, w, h, fn: openProfile });
  const avatarSize = Math.min(h * 0.79, W * 0.19);
  const avatarX = x + avatarSize * 0.66;
  const avatarY = y + h * 0.51;
  ctx.save();
  ctx.shadowColor = '#00DFFF';
  ctx.shadowBlur = (11 + Math.sin(time * 3.6) * 2) * U;
  ctx.strokeStyle = '#00DFFF';
  ctx.lineWidth = 2.2 * U;
  ctx.beginPath(); ctx.arc(avatarX, avatarY, avatarSize * 0.55, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  avatarBadge(profile.avatar, avatarX, avatarY, avatarSize);
  const award = awardFor(totalPoints);
  const awardIndex = AWARDS.indexOf(award);
  const next = AWARDS[awardIndex + 1];
  const tx = x + avatarSize * 1.34;
  const rightEdge = x + w - 12 * U;
  const maxTextW = rightEdge - tx;
  text(playerName, tx, y + h * 0.29, 16.5, '#fff', 'left');
  const category = `NIVEL ${awardIndex + 1} · ${award.name}`;
  ctx.save();
  ctx.beginPath(); ctx.rect(tx, y + h * 0.3, maxTextW * 0.72, h * 0.28); ctx.clip();
  text(category, tx, y + h * 0.47, 10.4, '#00DFFF', 'left');
  ctx.restore();
  const pointsX = x + w - W * 0.2;
  text(`${totalPoints.toLocaleString('es-AR')} pts`, rightEdge, y + h * 0.32, 12, '#FFD52B', 'right');
  const barX = tx;
  const barY = y + h * 0.61;
  const barW = Math.max(30 * U, pointsX - barX - 8 * U);
  const progress = next ? Math.max(0, Math.min(1, (totalPoints - award.min) / (next.min - award.min))) : 1;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, 8 * U, 5 * U); ctx.fill();
  const xp = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  xp.addColorStop(0, '#00DFFF'); xp.addColorStop(1, '#8B20F5');
  ctx.fillStyle = xp;
  ctx.beginPath(); ctx.roundRect(barX, barY, Math.max(4 * U, barW * progress), 8 * U, 5 * U); ctx.fill();
  const xpLabel = next ? `Faltan ${(next.min - totalPoints).toLocaleString('es-AR')} XP para subir` : '¡Nivel máximo!';
  text(xpLabel, barX, y + h * 0.88, 9, '#fff', 'left');
  text('RACHA · no registrada', rightEdge, y + h * 0.78, 8.4, '#e4d8ff', 'right');
}

function drawMenuGameCard(gameIndex, x, y, w, h) {
  const configs = [
    { title: ['DIRIGIR'], desc: ['Sé el director', 'de la orquesta'], color: '#1269F3', image: MENU_MASCOTS[0], action: openMeterSelect },
    { title: ['SEGUIR EL', 'RITMO'], desc: ['Sentí la música', 'y seguí el compás'], color: '#FF28CC', image: MENU_MASCOTS[1], action: () => openDifficultySelect(1) },
    { title: ['DESAFÍO', 'SINFÓNICO'], desc: ['Poné a prueba tu', 'oído musical'], color: '#1BD9AE', image: MENU_MASCOTS[2], action: () => openQuizSetup('sinfonico') },
    { title: ['ROSCO', 'MUSICAL'], desc: ['Respondé, completá', 'y ganá puntos'], color: '#FF9C24', image: MENU_MASCOTS[3], action: () => openQuizSetup('rosco') },
  ];
  const item = configs[gameIndex];
  drawNeonPanel(x, y, w, h, item.color,
    gameIndex === 0 ? 'rgba(19,104,245,0.96)' : gameIndex === 1 ? 'rgba(145,20,214,0.96)' : gameIndex === 2 ? 'rgba(10,146,117,0.96)' : 'rgba(206,91,12,0.96)',
    'rgba(15,15,52,0.98)');
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x + 3 * U, y + 3 * U, w - 6 * U, h - 6 * U, 14 * U); ctx.clip();
  const glow = ctx.createRadialGradient(x + w * 0.2, y + h * 0.52, 0, x + w * 0.2, y + h * 0.52, w * 0.55);
  glow.addColorStop(0, `${item.color}66`); glow.addColorStop(1, 'rgba(10,14,50,0)');
  ctx.fillStyle = glow; ctx.fillRect(x, y, w, h);
  const pressed = pointer.down && !(menuPointerDown && menuPointerDown.moved) && pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;
  if (pressed) {
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(x, y, w, h);
  }
  const mascotH = h * 0.96;
  drawFit(item.image, x + w * 0.235, y + h * 0.98, mascotH, Math.sin(time * 3 + gameIndex) * 2.2 * U);
  const textX = x + w * 0.43;
  const textW = w * 0.54;
  const titleSize = Math.min(...item.title.map((line) => menuFitSize(line, textW * 0.96, 15.5, 12)));
  const descSize = Math.min(...item.desc.map((line) => menuFitSize(line, textW * 0.98, 11.2, 10)));
  item.title.forEach((line, index) => text(line, textX + textW / 2, y + h * (0.22 + index * 0.19), titleSize, '#fff'));
  item.desc.forEach((line, index) => text(line, textX + textW / 2, y + h * (0.6 + index * 0.15), descSize, '#f8f4ff'));
  const record = best[GAMES[gameIndex].key];
  if (record) {
    const chipX = textX + textW * 0.08;
    const chipY = y + h * 0.82;
    const chipW = textW * 0.84;
    const chipH = Math.max(15 * U, h * 0.15);
    ctx.fillStyle = 'rgba(6,13,45,0.85)';
    ctx.beginPath(); ctx.roundRect(chipX, chipY, chipW, chipH, chipH / 2); ctx.fill();
    ctx.strokeStyle = item.color; ctx.lineWidth = 1.2 * U;
    ctx.beginPath(); ctx.roundRect(chipX, chipY, chipW, chipH, chipH / 2); ctx.stroke();
    text(`★ ${record.toLocaleString('es-AR')}`, chipX + chipW / 2, chipY + chipH * 0.72, 9.2, '#FFD52B');
  }
  ctx.restore();
  addClippedMenuHit(x, y, w, h, item.action);
}

function drawMenuNavigation(navY, navH, activeItem = 0) {
  const x = W * 0.035;
  const w = W * 0.93;
  drawNeonPanel(x, navY, w, navH, '#8B20F5', 'rgba(17,18,57,0.98)', 'rgba(8,15,45,0.98)');
  const labels = [
    { icon: '⌂', label: 'Inicio', fn: () => { currentNavItem = 0; menuScroll = 0; scene = 'menu'; } },
    { icon: '🎮', label: 'Juegos', fn: () => { currentNavItem = 1; menuScroll = 0; scene = 'menu'; } },
    { icon: '👤', label: 'Perfil', fn: openProfile },
    { icon: '▮▮▮', label: 'Ranking', fn: () => { currentNavItem = 3; scene = 'ranking'; } },
    { icon: '🏆', label: 'Premios', fn: () => { currentNavItem = 4; scene = 'premios'; } },
  ];
  const itemW = w / labels.length;
  labels.forEach((item, i) => {
    const ix = x + i * itemW;
    if (i === activeItem) {
      ctx.save();
      ctx.shadowColor = '#FF28CC'; ctx.shadowBlur = 8 * U;
      ctx.fillStyle = 'rgba(139,32,245,0.58)';
      ctx.beginPath(); ctx.roundRect(ix + 3 * U, navY + 4 * U, itemW - 6 * U, navH - 8 * U, 12 * U); ctx.fill();
      ctx.restore();
    }
    buttons.push({ x: ix, y: navY, w: itemW, h: navH, fn: item.fn });
    text(item.icon, ix + itemW / 2, navY + navH * 0.51, 18.5, i === activeItem ? '#fff' : '#dce6ff');
    text(item.label, ix + itemW / 2, navY + navH * 0.84, 11.2, i === activeItem ? '#fff' : '#dce6ff');
  });
}

function drawBottomNav(activeItem = -1) {
  const navH = Math.max(56 * U, 50);
  const navY = H - navH - 8 * U;
  drawMenuNavigation(navY, navH, activeItem);
}

// Tamaño de letra (en unidades U) que entra en maxW sin bajar de minPx píxeles CSS salvo que no haya lugar.
function menuFitSize(str, maxW, size, minPx = 11) {
  str = t(str);
  if (preFittedLabels.size < 500) preFittedLabels.add(str);
  ctx.font = `800 ${size * U}px ${FONT}`;
  const width = ctx.measureText(str).width;
  let fitted = width > maxW ? size * maxW / width : size;
  if (fitted * U < minPx) {
    ctx.font = `800 ${minPx}px ${FONT}`;
    const minWidth = ctx.measureText(str).width;
    fitted = (minWidth <= maxW ? minPx : minPx * maxW / minWidth) / U;
  }
  return fitted;
}

function drawMenuSectionTitle(label, y, color) {
  text(label, W / 2, y, menuFitSize(label, W * 0.9, 15.5, 13), color);
}

function drawMenuEnrollmentBanner(y = H * 0.424, h = Math.max(58 * U, H * 0.084)) {
  const x = W * 0.045;
  const w = W * 0.91;
  ctx.save();
  ctx.shadowColor = '#FFD52B';
  ctx.shadowBlur = (10 + Math.sin(time * 2.4) * 3) * U;
  drawNeonPanel(x, y, w, h, '#FFD52B', 'rgba(104,38,153,0.98)', 'rgba(20,38,94,0.98)');
  ctx.restore();
  ctx.globalAlpha = 0.72 + Math.sin(time * 2.7) * 0.18;
  text('♫', x + w * 0.075 + Math.sin(time * 1.8) * 3 * U, y + h * 0.65, 13, '#00DFFF');
  text('♪', x + w * 0.925 + Math.cos(time * 1.7) * 3 * U, y + h * 0.35, 13, '#FFB8F0');
  ctx.globalAlpha = 1;
  const bannerLabel = '🎻 ¡SUMATE A NUESTRA ORQUESTA REAL!';
  text(bannerLabel, W / 2, y + h * 0.45, menuFitSize(bannerLabel, w * 0.9, W < 360 ? 14.5 : 15.5, 12), '#fff');
  text('¡De la pantalla al escenario!', W / 2, y + h * 0.8, menuFitSize('¡De la pantalla al escenario!', w * 0.8, 12, 11), '#FFD52B');
  buttons.push({ x, y, w, h, fn: () => openOrchestraInfo('menu') });
}

function drawEscapeMenuButton(y = H * 0.52 + 3 * U, h = Math.max(54 * U, H * 0.075)) {
  const x = W * 0.045;
  const w = W * 0.91;
  ctx.save();
  ctx.shadowColor = '#FF28CC';
  ctx.shadowBlur = (12 + Math.sin(time * 3) * 3) * U;
  drawNeonPanel(x, y, w, h, '#FF28CC', 'rgba(145,20,214,0.98)', 'rgba(15,15,52,0.98)');
  ctx.restore();
  const py = pointer.y + (scene === 'menu' ? menuScroll : 0);
  const pressed = pointer.down && !(menuPointerDown && menuPointerDown.moved) && pointer.x >= x && pointer.x <= x + w && py >= y && py <= y + h;
  if (pressed) {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.roundRect(x + 3 * U, y + 3 * U, w - 6 * U, h - 6 * U, 13 * U); ctx.fill();
  }
  drawFit(MENU_MASCOTS[1], x + w * 0.17, y + h * 0.98, h * 0.94, Math.sin(time * 3.2) * 2.2 * U);
  text('¡ESCAPE DE SALIERI!', x + w * 0.62, y + h * 0.45, menuFitSize('¡ESCAPE DE SALIERI!', w * 0.62, 16, 13), '#fff');
  const escapeSub = 'CORRÉ, SALTÁ Y ESQUIVÁ SUS TRAVESURAS';
  text(escapeSub, x + w * 0.62, y + h * 0.78, menuFitSize(escapeSub, w * 0.66, 10, 10), '#FFD52B');
  buttons.push({ x, y, w, h, fn: startSalieriEscape });
}

function drawMenu() {
  drawMenuBackdrop(true);

  const navH = Math.max(56 * U, 50);
  const navY = H - navH - 8 * U;
  menuScrollTop = 0;
  menuNavTop = navY - 8 * U;
  // Distribución en flujo vertical (medidas mínimas en píxeles CSS reales; el contenido se desplaza).
  const left = W * 0.045;
  const fullW = W * 0.91;
  const btnGap = 10 + 6 * U; // separación visible ≈10–12 px descontando el canto 3D del botón
  // Sección A — perfil (posición original) + banners a casi todo el ancho.
  const bannerY = H * 0.418 + 8;
  const bannerH = Math.max(60, 58 * U, H * 0.084);
  const escapeY = bannerY + bannerH + 10;
  const escapeH = Math.max(60, 54 * U, H * 0.075);
  // Sección B — Elegí tu aventura.
  const headingBaseY = escapeY + escapeH + Math.max(34, 34 * U);
  const gap = Math.max(8, W * 0.028);
  const cardW = (fullW - gap) / 2;
  const cardH = Math.max(88, 80 * U, Math.min(H * 0.125, W * 0.3));
  const firstCardY = headingBaseY + Math.max(14, 14 * U);
  const rowGap = Math.max(10, 11 * U);
  // Sección C — Desafío del día.
  const dailyY = firstCardY + cardH * 2 + rowGap + 14;
  const dailyH = Math.max(84, 76 * U, H * 0.104);
  // Sección D — Herramientas musicales.
  const toolsTitleY = dailyY + dailyH + 34;
  const toolsY = toolsTitleY + 12;
  const toolsH = Math.max(64, 64 * U);
  // Sección E — Comunidad (2 × 2) y Ajustes aparte.
  const communityTitleY = toolsY + toolsH + 6 * U + 38;
  const communityY = communityTitleY + 12;
  const communityH = Math.max(58, 58 * U);
  const settingsY = communityY + (communityH + btnGap) * 2 + 4;
  const settingsH = Math.max(56, 56 * U);
  const contentEnd = settingsY + settingsH + 6 * U + 18;
  maybeShowSponsorIntro();
  menuMaxScroll = Math.max(0, contentEnd - menuNavTop + 12 * U);
  menuScroll = Math.max(0, Math.min(menuScroll, menuMaxScroll));

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, menuNavTop); ctx.clip();
  // Encabezado, perfil y banners forman parte de la misma página desplazable.
  const headerButtonsStart = buttons.length;
  ctx.save();
  ctx.translate(0, -menuScroll);
  drawMenuHeader();
  drawMenuOrchestra();
  drawMenuProfileCard();
  drawMenuEnrollmentBanner(bannerY, bannerH);
  drawEscapeMenuButton(escapeY, escapeH);
  ctx.restore();
  const headerButtons = buttons.splice(headerButtonsStart);
  headerButtons.forEach((b) => {
    const top = Math.max(0, b.y - menuScroll);
    const bottom = Math.min(menuNavTop, b.y - menuScroll + b.h);
    if (bottom > top) buttons.push({ ...b, y: top, h: bottom - top });
  });
  const headingY = headingBaseY - menuScroll;
  animatedTitle('ELEGÍ TU AVENTURA', W / 2, headingY, 21, '#FF28CC', W * 0.9);
  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = left + col * (cardW + gap);
    const y = firstCardY + row * (cardH + rowGap) - menuScroll;
    drawMenuGameCard(i, x, y, cardW, cardH);
  }
  const dy = dailyY - menuScroll;
  drawNeonPanel(left, dy, fullW, dailyH, '#FF28CC', 'rgba(73,17,145,0.98)', 'rgba(17,20,67,0.98)');
  const dailyTextW = W * 0.4;
  text('🏆', W * 0.12, dy + dailyH * 0.66, 25, '#FFD52B');
  text('DESAFÍO DEL DÍA', W * 0.42, dy + dailyH * 0.32, menuFitSize('DESAFÍO DEL DÍA', dailyTextW, 14.5, 12), '#FFD52B');
  text('Una ronda de Seguir el Ritmo', W * 0.42, dy + dailyH * 0.56, menuFitSize('Una ronda de Seguir el Ritmo', dailyTextW, 10.8, 10), '#fff');
  text('Puntaje real · sin bonus diario', W * 0.42, dy + dailyH * 0.8, menuFitSize('Puntaje real · sin bonus diario', dailyTextW, 9.6, 10), '#d9d7ff');
  const playW = W * 0.29;
  const playH = Math.max(44, dailyH * 0.5);
  drawMenuAction('JUGAR AHORA', left + fullW - playW - 8, dy + (dailyH - playH) / 2 - 3 * U, playW, playH,
    () => openDifficultySelect(1), '#FFD52B', menuFitSize('JUGAR AHORA', playW * 0.86, 12, 11));

  const drawMenuButtonGrid = (items, y, h, columns) => {
    const w = (fullW - btnGap * (columns - 1)) / columns;
    items.forEach((item, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      drawMenuAction(item.label, left + col * (w + btnGap), y + row * (h + btnGap) - menuScroll, w, h,
        item.fn, item.color, menuFitSize(item.label, w * 0.86, item.size || 14, 12));
    });
  };

  // Sección D — Herramientas musicales (capas DOM independientes del juego).
  drawMenuSectionTitle('🎵 HERRAMIENTAS MUSICALES', toolsTitleY - menuScroll, '#00DFFF');
  drawMenuButtonGrid([
    { label: '🎻 AFINADOR', color: '#00A8C8', fn: openTuner, size: 16 },
    { label: '🥁 METRÓNOMO', color: '#C21AA0', fn: openMetronome, size: 16 },
  ], toolsY, toolsH, 2);

  // Sección E — Comunidad.
  drawMenuSectionTitle('🤝 COMUNIDAD', communityTitleY - menuScroll, '#FFD52B');
  drawMenuButtonGrid([
    { label: '🎼 Orquesta', color: '#8B20F5', fn: () => { selectedGuideInstrument = -1; scene = 'instrument-guide'; } },
    { label: '📚 Clase', color: '#19B85A', fn: () => { scene = 'clase'; } },
    { label: '🎯 Misiones', color: '#1269F3', fn: () => { scene = 'missions'; } },
    { label: '🤝 Sponsors', color: '#C99A00', fn: openSponsors },
  ], communityY, communityH, 2);
  drawMenuButtonGrid([
    { label: '⚙ Ajustes', color: '#465bd8', fn: openSettings },
  ], settingsY, settingsH, 1);
  ctx.restore();
  drawBottomNav(currentNavItem);
}

function drawMissions() {
  drawMenuBackdrop();
  title('MISIONES', W / 2, H * 0.1, 28, '#FFD52B');
  drawNeonPanel(W * 0.06, H * 0.2, W * 0.88, H * 0.39, '#FF28CC', 'rgba(73,17,145,0.98)', 'rgba(17,20,67,0.98)');
  text('🏆', W / 2, H * 0.3, 34, '#FFD52B');
  text('DESAFÍO DESTACADO', W / 2, H * 0.37, 17, '#FFD52B');
  wrappedText('Jugá una ronda de Seguir el Ritmo y tratá de superar tu propio récord.', W / 2, H * 0.43, W * 0.72, 22, 14, '#fff');
  wrappedText('El puntaje depende de tu partida. No hay bonus ni racha diaria configurados.', W / 2, H * 0.52, W * 0.72, 19, 11, '#d8d5ff');
  button('🎵 JUGAR AHORA', W * 0.13, H * 0.67, W * 0.74, H * 0.075, () => openDifficultySelect(1), '#FFD52B', 17);
  button('🎻 Conocé la orquesta real', W * 0.13, H * 0.59, W * 0.74, H * 0.055,
    () => openOrchestraInfo('missions'), '#8B20F5', 11.5);
  button('← Volver al menú', W * 0.2, H * 0.79, W * 0.6, H * 0.065, returnToMenu, '#1269F3', 15);
  drawBottomNav(-1);
}

function deleteLocalProfile() {
  const confirmed = window.confirm(t('¿Borrar el perfil y todo el progreso guardado en este dispositivo? Esto no elimina puntajes que ya estén en el ranking online.'));
  if (!confirmed) return;
  try {
    const keysToRemove = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('oefv-')) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    window.alert(t('No se pudo borrar el perfil local. Revisá los permisos de almacenamiento del navegador.'));
    return;
  }
  window.location.reload();
}

function drawCreditsCurtainPanel(leftSide, panelWidth) {
  const edgeX = leftSide ? panelWidth : W - panelWidth;
  const gradient = ctx.createLinearGradient(leftSide ? 0 : W - panelWidth, 0, leftSide ? panelWidth : W, 0);
  gradient.addColorStop(0, '#4a1024');
  gradient.addColorStop(0.42, '#8d2037');
  gradient.addColorStop(0.76, '#651329');
  gradient.addColorStop(1, '#3c0c1d');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  if (leftSide) {
    ctx.moveTo(0, 0);
    ctx.lineTo(panelWidth, 0);
    ctx.bezierCurveTo(panelWidth * 0.78, H * 0.27, panelWidth * 0.93, H * 0.68, panelWidth, H);
    ctx.lineTo(0, H);
  } else {
    ctx.moveTo(W, 0);
    ctx.lineTo(W - panelWidth, 0);
    ctx.bezierCurveTo(W - panelWidth * 0.78, H * 0.27, W - panelWidth * 0.93, H * 0.68, W - panelWidth, H);
    ctx.lineTo(W, H);
  }
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = '#f5a34e';
  ctx.lineWidth = Math.max(1, 1.5 * U);
  for (let fold = 1; fold <= 4; fold++) {
    const fraction = fold / 5;
    const x = leftSide ? panelWidth * fraction : W - panelWidth * fraction;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x + (leftSide ? -1 : 1) * panelWidth * 0.11, H * 0.48, x, H);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#d9ae62';
  ctx.lineWidth = Math.max(1, 2 * U);
  ctx.beginPath();
  ctx.moveTo(edgeX, 0);
  ctx.lineTo(edgeX, H);
  ctx.stroke();
}

function drawCreditsTheater() {
  const background = ctx.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, '#211421');
  background.addColorStop(0.58, '#3d2030');
  background.addColorStop(1, '#140d1c');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#372033';
  ctx.fillRect(W * 0.12, H * 0.13, W * 0.76, H * 0.61);
  ctx.strokeStyle = '#a8763d';
  ctx.lineWidth = Math.max(1, 2 * U);
  ctx.strokeRect(W * 0.105, H * 0.115, W * 0.79, H * 0.65);
  ctx.strokeStyle = 'rgba(229,185,108,0.25)';
  ctx.lineWidth = Math.max(1, U);
  for (let i = 1; i <= 5; i++) {
    const x = W * (0.16 + i * 0.113);
    ctx.beginPath();
    ctx.moveTo(x, H * 0.16);
    ctx.lineTo(x, H * 0.71);
    ctx.stroke();
  }

  const light = ctx.createRadialGradient(W * 0.5, H * 0.45, H * 0.04, W * 0.5, H * 0.45, W * 0.46);
  light.addColorStop(0, `rgba(255,211,128,${0.2 + Math.min(creditsElapsed / 3, 1) * 0.14})`);
  light.addColorStop(0.55, 'rgba(255,177,86,0.08)');
  light.addColorStop(1, 'rgba(255,170,80,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#17101b';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.76);
  ctx.lineTo(W, H * 0.76);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d6a75b';
  ctx.lineWidth = Math.max(1, 2 * U);
  ctx.beginPath();
  ctx.moveTo(0, H * 0.77);
  ctx.quadraticCurveTo(W * 0.5, H * 0.73, W, H * 0.77);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,198,112,0.13)';
  ctx.beginPath();
  ctx.ellipse(W * 0.5, H * 0.84, W * 0.31, H * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  // Reflector central que sigue la escena.
  const spot = creditsCurtainOpen();
  if (spot > 0.05) {
    ctx.save();
    ctx.globalAlpha = spot * (0.75 + Math.sin(creditsElapsed * 0.9) * 0.08);
    const beam = ctx.createLinearGradient(W * 0.5, 0, W * 0.5, H * 0.8);
    beam.addColorStop(0, 'rgba(255,236,190,0.28)');
    beam.addColorStop(1, 'rgba(255,214,140,0.04)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(W * 0.46, 0); ctx.lineTo(W * 0.54, 0);
    ctx.lineTo(W * 0.75, H * 0.8); ctx.lineTo(W * 0.25, H * 0.8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // Partículas doradas y notas discretas.
    ctx.save();
    for (let i = 0; i < 22; i++) {
      const px = W * (0.18 + ((i * 0.137) % 0.64)) + Math.sin(creditsElapsed * 0.6 + i) * W * 0.012;
      const py = H * (0.82 - (((creditsElapsed * (0.025 + (i % 5) * 0.006)) + i * 0.071) % 0.7));
      ctx.globalAlpha = spot * (0.25 + 0.35 * Math.abs(Math.sin(creditsElapsed * 1.7 + i)));
      ctx.fillStyle = '#ffd98a';
      ctx.beginPath(); ctx.arc(px, py, Math.max(1, (1 + (i % 3) * 0.6) * U), 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = `${Math.max(10, H * 0.035)}px serif`;
    ctx.textAlign = 'center';
    for (let i = 0; i < 4; i++) {
      const nx = W * (0.2 + i * 0.2);
      const ny = H * (0.7 - ((creditsElapsed * 0.03 + i * 0.25) % 0.55));
      ctx.globalAlpha = spot * 0.18;
      ctx.fillStyle = '#f2cb78';
      ctx.fillText(i % 2 ? '♪' : '♫', nx, ny);
    }
    ctx.restore();
  }
  const panelWidth = W * (0.5 - 0.385 * creditsCurtainOpen());
  drawCreditsCurtainPanel(true, panelWidth);
  drawCreditsCurtainPanel(false, panelWidth);

  ctx.fillStyle = '#74182e';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H * 0.09);
  for (let i = 10; i >= 0; i--) {
    const x = W * i / 10;
    ctx.quadraticCurveTo(x - W * 0.025, H * 0.12, Math.max(0, x - W * 0.1), H * 0.085);
  }
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e3bd70';
  ctx.lineWidth = Math.max(1, 1.8 * U);
  ctx.beginPath();
  ctx.moveTo(0, H * 0.09);
  for (let i = 0; i <= 10; i++) {
    const x = W * i / 10;
    ctx.quadraticCurveTo(x + W * 0.025, H * 0.12, Math.min(W, x + W * 0.1), H * 0.085);
  }
  ctx.stroke();
}

function creditsPhaseAlpha(start, end) {
  const fade = 0.6;
  return Math.max(0, Math.min(1, (creditsElapsed - start) / fade, (end - creditsElapsed) / fade));
}

function drawCreditsPage(alpha, content) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  content();
  ctx.restore();
}

function drawCreditsFox(heightFactor, centerX, footY, bow = 0) {
  const fox = CREDITS_FOX;
  if (!fox.complete || !fox.naturalWidth || !fox.naturalHeight) return;
  const height = H * heightFactor;
  const width = height * fox.naturalWidth / fox.naturalHeight;
  const bob = Math.sin(creditsElapsed * 2.3) * H * 0.006 * (1 - bow);
  // Reverencia suave: el personaje completo se inclina desde los pies, sin deformarse.
  ctx.save();
  ctx.translate(centerX, footY + bob);
  ctx.rotate(bow * 0.14);
  ctx.drawImage(fox, -width / 2, -height, width, height);
  ctx.restore();
}

// Línea de tiempo de los créditos (segundos).
const CREDITS_END = 44;
const CREDITS_SCENES = {
  title: [3.2, 8.4],
  creator: [8.4, 14],
  team: [14, 21],
  school: [21, 26.2],
  animals: [26.2, 30.4],
  message: [30.4, 37.6],
  fox: [37.6, 43.6],
};
let creditsClapPlayed = false;

function creditsCurtainOpen() {
  const ease = (p) => { const c = Math.max(0, Math.min(1, p)); return c * c * (3 - 2 * c); };
  const opening = ease((creditsElapsed - 0.8) / 2.6);
  const closing = ease((creditsElapsed - 41.6) / 2.2);
  return opening * (1 - closing);
}

function creditsFont(px, family = 'serif', weight = '700', italic = false) {
  const fam = family === 'serif' ? '"Georgia","Times New Roman",serif' : FONT;
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${fam}`;
}

// Texto que se reduce automáticamente para no salirse del ancho disponible.
function creditsText(str, x, y, px, color, maxW, family = 'serif', weight = '700', italic = false) {
  str = t(str);
  let size = px;
  ctx.font = creditsFont(size, family, weight, italic);
  const measured = ctx.measureText(str).width;
  if (measured > maxW) size = Math.max(8, size * maxW / measured);
  ctx.font = creditsFont(size, family, weight, italic);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.strokeStyle = 'rgba(25,6,18,0.8)';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.textBaseline = 'alphabetic';
}

// Párrafo que ajusta el tamaño hasta entrar completo en la caja (sin cortar frases).
function creditsParagraph(str, x, centerY, maxW, maxH, px, color, italic = true) {
  str = t(str);
  let size = px;
  let lines = [];
  for (let attempt = 0; attempt < 14; attempt++) {
    ctx.font = creditsFont(size, 'serif', '600', italic);
    lines = [];
    let line = '';
    for (const word of str.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length * size * 1.4 <= maxH) break;
    size *= 0.9;
  }
  const lh = size * 1.4;
  const startY = centerY - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => creditsText(l, x, startY + i * lh, size, color, maxW, 'serif', '600', italic));
  return startY + lines.length * lh;
}

function creditsSceneAlpha(name) {
  const [start, end] = CREDITS_SCENES[name];
  const fade = 0.9;
  const a = Math.max(0, Math.min(1, (creditsElapsed - start) / fade, (end - creditsElapsed) / fade));
  return a * a * (3 - 2 * a);
}

function drawCredits() {
  buttons = [];
  drawCreditsTheater();
  const k = Math.min(W / 760, H / 430);
  const safeW = W * 0.6;
  const cx = W / 2;
  const rise = (name) => (1 - creditsSceneAlpha(name)) * H * 0.02;
  const gold = '#f2cb78';
  const ivory = '#fff6df';

  drawCreditsPage(creditsSceneAlpha('title'), () => {
    const r = rise('title');
    creditsText('ORQUESTA ESCUELA', cx, H * 0.4 + r, 46 * k, gold, safeW, 'game', '400');
    creditsText('UNA AVENTURA MUSICAL', cx, H * 0.53 + r, 22 * k, ivory, safeW, 'serif', '700');
    if (getLang() === 'en') creditsText(SLOGAN_EN, cx, H * 0.62 + r, 15 * k, gold, safeW, 'serif', '600', true);
  });

  drawCreditsPage(creditsSceneAlpha('creator'), () => {
    const r = rise('creator');
    creditsText('UNA CREACIÓN DE', cx, H * 0.36 + r, 17 * k, gold, safeW, 'serif', '600', true);
    creditsText('SEBASTIÁN NAHUEL MENDIZÁBAL', cx, H * 0.48 + r, 38 * k, ivory, safeW, 'serif', '700');
    ctx.strokeStyle = 'rgba(242,203,120,0.7)';
    ctx.lineWidth = Math.max(1, 1.3 * U);
    ctx.beginPath(); ctx.moveTo(cx - safeW * 0.3, H * 0.56 + r); ctx.lineTo(cx + safeW * 0.3, H * 0.56 + r); ctx.stroke();
  });

  drawCreditsPage(creditsSceneAlpha('team'), () => {
    const r = rise('team');
    const rows = [
      ['IDEA ORIGINAL, CREACIÓN Y DIRECCIÓN', 'SEBASTIÁN NAHUEL MENDIZÁBAL'],
      ['CONCEPTO EDUCATIVO Y DISEÑO DE LA EXPERIENCIA', 'SEBASTIÁN NAHUEL MENDIZÁBAL'],
      ['DESARROLLO CON ASISTENCIA DE INTELIGENCIA ARTIFICIAL', 'Rosebud AI y ChatGPT'],
    ];
    rows.forEach(([role, name], i) => {
      const y = H * (0.25 + i * 0.165) + r;
      creditsText(role, cx, y, 13 * k, gold, safeW, 'serif', '600', true);
      creditsText(name, cx, y + H * 0.06, 21 * k, ivory, safeW, 'serif', '700');
    });
  });

  drawCreditsPage(creditsSceneAlpha('school'), () => {
    const r = rise('school');
    const logoW = Math.min(W * 0.22, H * 0.42);
    const logoH = logoW * 771 / 1536;
    if (SCHOOL_LOGO.complete && SCHOOL_LOGO.naturalWidth) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,248,232,0.94)';
      ctx.beginPath(); ctx.roundRect(cx - logoW / 2 - 8 * U, H * 0.17 + r - 6 * U, logoW + 16 * U, logoH + 12 * U, 10 * U); ctx.fill();
      ctx.restore();
      drawSchoolLogoKeyed(cx - logoW / 2, H * 0.17 + r, logoW, logoH, true, true);
    }
    const base = H * 0.17 + logoH + H * 0.09 + r;
    creditsText('INSPIRADO EN LA', cx, base, 14 * k, gold, safeW, 'serif', '600', true);
    creditsText('ORQUESTA ESCUELA DE FLORENCIO VARELA', cx, base + H * 0.08, 26 * k, ivory, safeW, 'serif', '700');
    creditsText('PROVINCIA DE BUENOS AIRES — ARGENTINA', cx, base + H * 0.155, 13 * k, gold, safeW, 'serif', '600');
    creditsParagraph('Un videojuego nacido en la Orquesta Escuela de Florencio Varela, Buenos Aires, Argentina. Creado por Sebastián Nahuel Mendizábal.',
      cx, base + H * 0.235, safeW, H * 0.09, 11 * k, ivory);
  });

  drawCreditsPage(creditsSceneAlpha('animals'), () => {
    const r = rise('animals');
    creditsText('NUESTROS MÚSICOS', cx, H * 0.24 + r, 20 * k, gold, safeW, 'serif', '700');
    const n = MENU_MASCOTS.length;
    const span = W * 0.62;
    const mh = Math.min(H * 0.34, span / n * 1.5);
    MENU_MASCOTS.forEach((m, i) => {
      const x = cx - span / 2 + span * (i + 0.5) / n;
      const bob = Math.sin(creditsElapsed * 2.4 + i * 0.8) * H * 0.008;
      drawFit(m, x, H * 0.72, mh, bob);
    });
  });

  drawCreditsPage(creditsSceneAlpha('message'), () => {
    const r = rise('message');
    const end = creditsParagraph(
      '“Este videojuego nació para acercar la música a las nuevas generaciones y demostrar que todos podemos formar parte de una orquesta.',
      cx, H * 0.29 + r, safeW, H * 0.2, 17 * k, ivory);
    creditsParagraph(
      'Porque la música no solamente se aprende: también se comparte, se disfruta y nos ayuda a crecer”.',
      cx, end + H * 0.08, safeW, H * 0.16, 17 * k, ivory);
    creditsText('— Sebastián Nahuel Mendizábal', cx, H * 0.7 + r, 15 * k, gold, safeW, 'serif', '700', true);
  });

  drawCreditsPage(creditsSceneAlpha('fox'), () => {
    const t = creditsElapsed - CREDITS_SCENES.fox[0];
    const bow = Math.max(0, Math.sin(Math.max(0, Math.min(1, (t - 0.6) / 1.6)) * Math.PI));
    drawCreditsFox(0.48, cx, H * 0.76, bow);
    if (t > 0.5 && !creditsClapPlayed) { creditsClapPlayed = true; playSfx(sfxClap); }
  });

  // Frase final: aparece con el zorro y queda sobre el telón cerrado.
  const finalAlpha = Math.max(0, Math.min(1, (creditsElapsed - (CREDITS_SCENES.fox[0] + 1.6)) / 1.2));
  drawCreditsPage(finalAlpha, () => {
    const c = Math.max(0, Math.min(1, (creditsElapsed - 41.6) / 2.2));
    const closeT = c * c * (3 - 2 * c);
    const y = H * (0.18 + 0.24 * closeT);
    creditsParagraph('LA MÚSICA ES UNA AVENTURA QUE TODOS PODEMOS VIVIR', cx, y, safeW, H * 0.14, 22 * k, '#ffe7a8', false);
  });

  const bw = Math.min(W * 0.2, 150 * U);
  const bh = Math.min(H * 0.09, 34 * U);
  if (creditsElapsed < CREDITS_END) {
    button('OMITIR »', W - bw - W * 0.02, H * 0.015, bw, bh, skipCredits, '#8b3247', 8.5);
    button('← VOLVER AL MENÚ', W * 0.02, H - bh - H * 0.02, bw * 1.3, bh, returnToMenu, '#8b20f5', 8.5);
  } else {
    const fw = Math.min(W * 0.36, 260 * U);
    const fh = Math.min(H * 0.12, 46 * U);
    button('← VOLVER AL MENÚ', cx - fw / 2, H * 0.62, fw, fh, returnToMenu, '#8b20f5', 12);
  }
}

function drawSettings() {
  drawMenuBackdrop();
  title('CONFIGURACIÓN', W / 2, H * 0.11, 25, '#FFD52B');
  // Selector de idioma: cambia los textos al instante, sin reiniciar nada.
  const langW = W * 0.34;
  const langH = Math.max(36, H * 0.045);
  const langY = H * 0.128;
  [['es', '🇦🇷 Español', W / 2 - langW - W * 0.015], ['en', '🇬🇧 English', W / 2 + W * 0.015]].forEach(([code, label, lx]) => {
    const active = getLang() === code;
    button(active ? `✓ ${label}` : label, lx, langY, langW, langH, () => setLang(code), active ? '#22a879' : '#3a4bd8',
      menuFitSize(active ? `✓ ${label}` : label, langW * 0.86, 12, 11));
  });
  drawNeonPanel(W * 0.07, H * 0.2, W * 0.86, H * 0.38, '#00DFFF', 'rgba(23,30,83,0.98)', 'rgba(11,18,51,0.98)');
  text('BIENVENIDA ANIMADA', W / 2, H * 0.29, 16, '#fff');
  text('Al iniciar una nueva sesión', W / 2, H * 0.34, 12, '#dce6ff');
  text('💾 Partida guardada solo en este dispositivo · nube no configurada', W / 2, H * 0.585, W < 365 ? 8.2 : 10, '#9fe8ff');
  button(`Reproducir al iniciar: ${welcomeEnabled ? 'SÍ' : 'NO'}`, W * 0.14, H * 0.39, W * 0.72, H * 0.075,
    toggleWelcomePreference, welcomeEnabled ? '#22a879' : '#46516b', 14);
  wrappedText('Podés volver a ver la presentación desde acá cuando quieras.', W / 2, H * 0.53, W * 0.72, 18, 12, '#fff');
  button('▶  VER BIENVENIDA', W * 0.055, H * 0.64, W * 0.43, H * 0.075, launchWelcome, '#8b20f5', W < 365 ? 10 : 12);
  button('🎭  VER CRÉDITOS', W * 0.515, H * 0.64, W * 0.43, H * 0.075, openCredits, '#8b3247', W < 365 ? 10 : 12);
  button('🗑  BORRAR PERFIL LOCAL', W * 0.14, H * 0.735, W * 0.72, H * 0.055, deleteLocalProfile, '#a93649', 11);
  button('← Volver al menú', W * 0.2, H * 0.82, W * 0.6, H * 0.06, returnToMenu, '#1269F3', 14);
  drawBottomNav(-1);
}

function profileFamilyColor(family) {
  if (family.includes('Cuerdas')) return '#FFD52B';
  if (family.includes('metal')) return '#FF28CC';
  if (family.includes('madera')) return '#00DFFF';
  if (family.includes('Percusión')) return '#38E0B1';
  return '#A978FF';
}

function drawProfileSectionHeader(label, y, accent, icon = '') {
  const w = W * 0.74;
  const x = (W - w) / 2;
  const h = 27 * U;
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10 * U;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(50,34,105,0.96)');
  g.addColorStop(1, 'rgba(16,24,65,0.96)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 13 * U); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5 * U; ctx.stroke();
  ctx.restore();
  text(`${icon ? `${icon} ` : ''}${label}`, W / 2, y + h * 0.69, 12, '#fff');
}

function drawProfileChoiceCard(rect, { group, index, image, label, accent, imageHeight }) {
  const selected = (group === 'avatar' ? profile.avatar : group === 'instrument' ? profile.instrument : profile.composer) === index;
  const pulseActive = profilePulse.group === group && profilePulse.index === index && profilePulse.ends > time;
  const bounce = pulseActive ? Math.sin(((profilePulse.ends - time) / 0.48) * Math.PI) * 4 * U : 0;
  const clippedTop = Math.max(rect.y, profileScrollTop);
  const clippedBottom = Math.min(rect.y + rect.h, profileScrollBottom);
  if (clippedBottom <= clippedTop) return;
  buttons.push({
    x: rect.x,
    y: clippedTop,
    w: rect.w,
    h: clippedBottom - clippedTop,
    fn: () => selectProfileOption(group, index),
  });
  ctx.save();
  ctx.shadowColor = selected ? accent : 'rgba(0,0,0,0.34)';
  ctx.shadowBlur = selected ? (10 + Math.sin(time * 4.6) * 2.2) * U : 3 * U;
  const fill = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  fill.addColorStop(0, selected ? 'rgba(31,54,104,0.98)' : 'rgba(13,21,52,0.96)');
  fill.addColorStop(1, 'rgba(10,14,38,0.98)');
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 13 * U); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? accent : 'rgba(104,137,214,0.72)';
  ctx.lineWidth = selected ? (2.4 + Math.sin(time * 4.6) * 0.45) * U : 1.2 * U;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x + 2 * U, rect.y + 2 * U, rect.w - 4 * U, rect.h - 4 * U, 11 * U);
  ctx.clip();
  if (image?.complete && image.naturalWidth) {
    const maxH = imageHeight || rect.h * 0.68;
    drawGuideInstrumentImage(image, rect.x + rect.w / 2, rect.y + rect.h * 0.55 - bounce, rect.w * 0.78, maxH);
  }
  ctx.restore();
  if (label) text(label, rect.x + rect.w / 2, rect.y + rect.h * 0.93, group === 'composer' ? 9.5 : 10, '#f8f7ff');
  if (selected) {
    const cx = rect.x + rect.w - 12 * U;
    const cy = rect.y + 12 * U;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx, cy, 8 * U, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8 * U;
    ctx.beginPath(); ctx.moveTo(cx - 3.6 * U, cy); ctx.lineTo(cx - 0.8 * U, cy + 2.8 * U); ctx.lineTo(cx + 4 * U, cy - 3.3 * U); ctx.stroke();
  }
  ctx.restore();
}

function drawProfileStyleGlyph(type, cx, cy, scale, color) {
  const s = scale;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(191,181,255,0.16)';
  ctx.lineWidth = 2.2 * U;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (type === 'headphones') {
    ctx.beginPath(); ctx.arc(cx, cy + 3 * s, 13 * s, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(cx - 15 * s, cy + 1 * s, 5 * s, 12 * s, 2 * s); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(cx + 10 * s, cy + 1 * s, 5 * s, 12 * s, 2 * s); ctx.fill(); ctx.stroke();
  } else if (type === 'bowtie') {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - 13 * s, cy - 8 * s); ctx.lineTo(cx - 12 * s, cy + 8 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 13 * s, cy - 8 * s); ctx.lineTo(cx + 12 * s, cy + 8 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2.5 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (type === 'cap') {
    ctx.beginPath(); ctx.moveTo(cx - 14 * s, cy + 4 * s); ctx.quadraticCurveTo(cx - 10 * s, cy - 10 * s, cx + 4 * s, cy - 8 * s); ctx.quadraticCurveTo(cx + 12 * s, cy - 7 * s, cx + 13 * s, cy + 3 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 14 * s, cy + 4 * s); ctx.quadraticCurveTo(cx + 1 * s, cy + 7 * s, cx + 15 * s, cy + 4 * s); ctx.stroke();
  } else if (type === 'glasses') {
    ctx.beginPath(); ctx.roundRect(cx - 16 * s, cy - 7 * s, 13 * s, 11 * s, 4 * s); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(cx + 3 * s, cy - 7 * s, 13 * s, 11 * s, 4 * s); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 3 * s, cy - 3 * s); ctx.lineTo(cx + 3 * s, cy - 3 * s); ctx.moveTo(cx - 16 * s, cy - 4 * s); ctx.lineTo(cx - 20 * s, cy - 7 * s); ctx.moveTo(cx + 16 * s, cy - 4 * s); ctx.lineTo(cx + 20 * s, cy - 7 * s); ctx.stroke();
  } else if (type === 'concert-suit') {
    ctx.beginPath(); ctx.moveTo(cx - 13 * s, cy - 10 * s); ctx.lineTo(cx - 7 * s, cy - 14 * s); ctx.lineTo(cx, cy - 8 * s); ctx.lineTo(cx + 7 * s, cy - 14 * s); ctx.lineTo(cx + 13 * s, cy - 10 * s); ctx.lineTo(cx + 11 * s, cy + 13 * s); ctx.lineTo(cx - 11 * s, cy + 13 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 7 * s, cy - 13 * s); ctx.lineTo(cx - 3 * s, cy - 2 * s); ctx.lineTo(cx, cy - 7 * s); ctx.lineTo(cx + 3 * s, cy - 2 * s); ctx.lineTo(cx + 7 * s, cy - 13 * s); ctx.moveTo(cx, cy - 7 * s); ctx.lineTo(cx, cy + 10 * s); ctx.stroke();
  } else if (type === 'streetwear') {
    ctx.beginPath(); ctx.moveTo(cx - 11 * s, cy - 9 * s); ctx.quadraticCurveTo(cx - 10 * s, cy - 16 * s, cx, cy - 16 * s); ctx.quadraticCurveTo(cx + 10 * s, cy - 16 * s, cx + 11 * s, cy - 9 * s); ctx.lineTo(cx + 15 * s, cy - 4 * s); ctx.lineTo(cx + 11 * s, cy + 13 * s); ctx.lineTo(cx - 11 * s, cy + 13 * s); ctx.lineTo(cx - 15 * s, cy - 4 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 6 * s, cy - 10 * s); ctx.quadraticCurveTo(cx, cy - 3 * s, cx + 6 * s, cy - 10 * s); ctx.moveTo(cx - 3 * s, cy - 4 * s); ctx.lineTo(cx - 2 * s, cy + 4 * s); ctx.moveTo(cx + 3 * s, cy - 4 * s); ctx.lineTo(cx + 2 * s, cy + 4 * s); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(cx - 12 * s, cy - 10 * s); ctx.lineTo(cx - 6 * s, cy - 14 * s); ctx.lineTo(cx, cy - 8 * s); ctx.lineTo(cx + 6 * s, cy - 14 * s); ctx.lineTo(cx + 12 * s, cy - 10 * s); ctx.lineTo(cx + 10 * s, cy + 13 * s); ctx.lineTo(cx - 10 * s, cy + 13 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 6 * s, cy - 13 * s); ctx.lineTo(cx, cy - 6 * s); ctx.lineTo(cx + 6 * s, cy - 13 * s); ctx.moveTo(cx, cy - 6 * s); ctx.lineTo(cx, cy + 10 * s); ctx.stroke();
    [-1, 1].forEach((side) => { ctx.beginPath(); ctx.arc(cx + side * 4 * s, cy + side * 2 * s, 0.9 * s, 0, Math.PI * 2); ctx.stroke(); });
  }
  ctx.restore();
}

function drawProfileStyleCard(rect, option, accent) {
  drawNeonPanel(rect.x, rect.y, rect.w, rect.h, 'rgba(120,143,210,0.72)', 'rgba(16,23,54,0.94)', 'rgba(10,15,39,0.96)');
  drawProfileStyleGlyph(option.glyph, rect.x + rect.w / 2, rect.y + rect.h * 0.37, 0.9 * U, accent);
  text(option.label, rect.x + rect.w / 2, rect.y + rect.h * 0.69, 9.5, '#f7f5ff');
  text('PRÓXIMAMENTE', rect.x + rect.w / 2, rect.y + rect.h * 0.9, 7.4, '#c6d2ee');
}

function drawProfileHero() {
  const titleY = H * 0.072;
  animatedTitle('MI PERFIL MUSICAL', W / 2, titleY, 29, '#00DFFF', W * 0.92);
  const avatarSize = Math.min(H * 0.18, W * 0.31);
  const cx = W * 0.17;
  const cy = H * 0.215;
  const heroBounce = profilePulse.group === 'avatar' && profilePulse.index === profile.avatar && profilePulse.ends > time
    ? Math.sin(((profilePulse.ends - time) / 0.48) * Math.PI) * 3 * U : 0;
  ctx.save();
  ctx.shadowColor = '#00DFFF'; ctx.shadowBlur = 17 * U;
  ctx.fillStyle = 'rgba(18,105,243,0.5)';
  ctx.beginPath(); ctx.arc(cx, cy, avatarSize * 0.54, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  avatarBadge(profile.avatar, cx, cy - heroBounce, avatarSize);
  ctx.save();
  ctx.shadowColor = '#00DFFF'; ctx.shadowBlur = 9 * U;
  ctx.strokeStyle = '#00DFFF'; ctx.lineWidth = 3 * U;
  ctx.beginPath(); ctx.arc(cx, cy - heroBounce, avatarSize * 0.51, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  const selectedInstrument = INSTRUMENTS[profile.instrument] || INSTRUMENTS[0];
  const instrumentBadge = { x: W * 0.015, y: H * 0.283, w: W * 0.30, h: 25 * U };
  drawNeonPanel(instrumentBadge.x, instrumentBadge.y, instrumentBadge.w, instrumentBadge.h,
    profileFamilyColor(selectedInstrument.family), 'rgba(12,26,61,0.98)', 'rgba(12,14,43,0.98)');
  drawGuideInstrumentImage(selectedInstrument.img, instrumentBadge.x + 13 * U, instrumentBadge.y + instrumentBadge.h / 2, 21 * U, 18 * U);
  text(selectedInstrument.name, instrumentBadge.x + 28 * U, instrumentBadge.y + instrumentBadge.h * 0.69, 7.8, '#fff', 'left');

  const nameRect = { x: W * 0.34, y: H * 0.135, w: W * 0.61, h: H * 0.063 };
  drawNeonPanel(nameRect.x, nameRect.y, nameRect.w, nameRect.h, '#8B20F5', 'rgba(21,28,74,0.98)', 'rgba(13,16,48,0.98)');
  buttons.push({ ...nameRect, fn: renamePlayer });
  text('✎', nameRect.x + 16 * U, nameRect.y + nameRect.h * 0.66, 15, '#00DFFF');
  const nameFont = W < 365 ? 12.5 : 14.5;
  text(playerName, nameRect.x + 33 * U, nameRect.y + nameRect.h * 0.65, nameFont, '#fff', 'left');

  const award = awardFor(totalPoints);
  const awardIndex = AWARDS.indexOf(award);
  const nextAward = AWARDS[awardIndex + 1];
  const rankingIndex = ranking.findIndex((entry) => entry.name === playerName);
  const statsRect = { x: W * 0.34, y: H * 0.212, w: W * 0.61, h: H * 0.112 };
  drawNeonPanel(statsRect.x, statsRect.y, statsRect.w, statsRect.h, '#00DFFF', 'rgba(13,38,75,0.96)', 'rgba(12,17,51,0.98)');
  text(`${award.icon} NIVEL ${awardIndex + 1} · ${award.name}`, statsRect.x + 8 * U, statsRect.y + statsRect.h * 0.23, 9.2, '#FFD52B', 'left');
  const rankingLabel = rankingIndex >= 0 ? `RANKING #${rankingIndex + 1}` : 'RANKING · sin puesto';
  text(`${totalPoints.toLocaleString('es-AR')} pts  ·  ${rankingLabel}`, statsRect.x + 8 * U, statsRect.y + statsRect.h * 0.43, 8.4, '#fff', 'left');
  const earnedAwards = AWARDS.filter((entry) => totalPoints >= entry.min);
  text(`INSIGNIAS OBTENIDAS · ${earnedAwards.length}`, statsRect.x + 8 * U, statsRect.y + statsRect.h * 0.61, 7.4, '#e9ddff', 'left');
  earnedAwards.slice(-4).forEach((entry, index, icons) => {
    text(entry.icon, statsRect.x + statsRect.w - (icons.length - index) * 13 * U, statsRect.y + statsRect.h * 0.62, 9, '#fff');
  });
  const barX = statsRect.x + 8 * U;
  const barY = statsRect.y + statsRect.h * 0.73;
  const barW = statsRect.w - 16 * U;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, 6 * U, 4 * U); ctx.fill();
  const progress = nextAward ? Math.max(0, Math.min(1, (totalPoints - award.min) / (nextAward.min - award.min))) : 1;
  const xp = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  xp.addColorStop(0, '#00DFFF'); xp.addColorStop(1, '#FF28CC');
  ctx.fillStyle = xp;
  ctx.beginPath(); ctx.roundRect(barX, barY, Math.max(4 * U, barW * progress), 6 * U, 4 * U); ctx.fill();
  const tierProgress = nextAward ? totalPoints - award.min : totalPoints;
  const tierGoal = nextAward ? nextAward.min - award.min : totalPoints;
  text(nextAward ? `${tierProgress.toLocaleString('es-AR')} / ${tierGoal.toLocaleString('es-AR')} pts al próximo premio` : 'INSIGNIA MÁXIMA ALCANZADA', statsRect.x + 8 * U, statsRect.y + statsRect.h * 0.97, 6.8, '#e7f7ff', 'left');
}

function drawProfileSaveButton(saveY, saveH) {
  const x = W * 0.07;
  const w = W * 0.86;
  button('✓  GUARDAR MI PERFIL', x, saveY, w, saveH, saveProfileAndReturn, '#8B20F5', 16);
  ctx.save();
  ctx.shadowColor = '#FFD52B'; ctx.shadowBlur = 10 * U;
  ctx.strokeStyle = '#FFD52B'; ctx.lineWidth = 2.3 * U;
  ctx.beginPath(); ctx.roundRect(x, saveY, w, saveH, Math.min(saveH / 2, 14 * U)); ctx.stroke();
  ctx.restore();
}

function drawProfile() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,10,31,0.68)';
  ctx.fillRect(0, 0, W, H);
  drawMovingLights();
  for (let i = 0; i < 9; i++) {
    const x = (i * 53 + Math.sin(time * 0.7 + i) * 12) % W;
    const y = H * (0.12 + ((i * 29) % 68) / 100);
    ctx.globalAlpha = 0.24 + (i % 3) * 0.12;
    text(i % 2 ? '♪' : '♫', x, y, 8 + (i % 3) * 2, i % 2 ? '#00DFFF' : '#FF28CC');
  }
  ctx.globalAlpha = 1;
  drawProfileHero();

  const navH = Math.max(56 * U, 50);
  const navY = H - navH - 8 * U;
  const saveH = Math.max(54 * U, 50);
  const saveY = navY - saveH - 7 * U;
  profileScrollTop = H * 0.33;
  profileScrollBottom = saveY - 13 * U;

  const marginX = W * 0.055;
  const gapX = W * 0.025;
  const colW = (W - marginX * 2 - gapX * 2) / 3;
  const avatarH = Math.max(66 * U, Math.min(H * 0.105, W * 0.23));
  const instrumentH = Math.max(64 * U, Math.min(H * 0.095, W * 0.21));
  const rowGap = 9 * U;

  let cursor = profileScrollTop + 12 * U;
  const avatarHeading = cursor;
  const avatarCardsY = avatarHeading + 32 * U;
  const avatarBottom = avatarCardsY + 3 * avatarH + 2 * rowGap;
  const instrumentHeading = avatarBottom + 17 * U;
  const instrumentCardsY = instrumentHeading + 32 * U;
  const instrumentRows = Math.ceil(INSTRUMENTS.length / 3);
  const instrumentBottom = instrumentCardsY + instrumentRows * instrumentH + (instrumentRows - 1) * rowGap;
  const styleHeading = instrumentBottom + 17 * U;
  const styleH = Math.max(62 * U, Math.min(H * 0.094, W * 0.21));
  const accessoryCardsY = styleHeading + 55 * U;
  const accessoryRows = 2;
  const accessoryBottom = accessoryCardsY + accessoryRows * styleH + (accessoryRows - 1) * rowGap;
  const outfitLabelY = accessoryBottom + 19 * U;
  const outfitCardsY = outfitLabelY + 15 * U;
  const outfitBottom = outfitCardsY + styleH;
  const contentEnd = outfitBottom + 20 * U;
  profileScrollMax = Math.max(0, contentEnd - profileScrollBottom + 8 * U);
  profileScroll = Math.max(0, Math.min(profileScroll, profileScrollMax));

  ctx.save();
  ctx.beginPath(); ctx.rect(0, profileScrollTop, W, profileScrollBottom - profileScrollTop); ctx.clip();
  drawProfileSectionHeader('AVATAR · ELEGÍ TU PERSONAJE', avatarHeading - profileScroll, '#00DFFF');
  const selectableAvatars = AVATARS.filter((avatar, index) => index !== AVATARS.length - 1);
  selectableAvatars.forEach((avatar, index) => {
    const rect = {
      x: marginX + (index % 3) * (colW + gapX),
      y: avatarCardsY + Math.floor(index / 3) * (avatarH + rowGap) - profileScroll,
      w: colW,
      h: avatarH,
    };
    drawProfileChoiceCard(rect, {
      group: 'avatar', index, image: avatar.img, label: avatar.name, accent: '#00DFFF', imageHeight: avatarH * 0.72,
    });
  });

  drawProfileSectionHeader('INSTRUMENTO', instrumentHeading - profileScroll, '#FFD52B', '♫');
  INSTRUMENTS.forEach((instrument, index) => {
    const rect = {
      x: marginX + (index % 3) * (colW + gapX),
      y: instrumentCardsY + Math.floor(index / 3) * (instrumentH + rowGap) - profileScroll,
      w: colW,
      h: instrumentH,
    };
    drawProfileChoiceCard(rect, {
      group: 'instrument', index, image: instrument.img, label: instrument.name,
      accent: profileFamilyColor(instrument.family), imageHeight: instrumentH * 0.58,
    });
  });

  drawProfileSectionHeader('MI ESTILO · PRÓXIMAMENTE', styleHeading - profileScroll, '#8B20F5');
  text('ACCESORIOS · DESBLOQUEOS POR LOGROS', marginX, styleHeading + 43 * U - profileScroll, 8.5, '#00DFFF', 'left');
  const accessoryOptions = [
    { label: 'Auriculares', glyph: 'headphones' },
    { label: 'Moño', glyph: 'bowtie' },
    { label: 'Gorra', glyph: 'cap' },
    { label: 'Anteojos', glyph: 'glasses' },
  ];
  accessoryOptions.forEach((option, index) => {
    const rect = {
      x: marginX + (index % 3) * (colW + gapX),
      y: accessoryCardsY + Math.floor(index / 3) * (styleH + rowGap) - profileScroll,
      w: colW,
      h: styleH,
    };
    drawProfileStyleCard(rect, option, '#00DFFF');
  });
  text('VESTUARIO', marginX, outfitLabelY + 10 * U - profileScroll, 8.5, '#FF28CC', 'left');
  const outfitOptions = [
    { label: 'Traje de concierto', glyph: 'concert-suit' },
    { label: 'Ropa urbana', glyph: 'streetwear' },
    { label: 'Uniforme musical', glyph: 'uniform' },
  ];
  outfitOptions.forEach((option, index) => {
    const rect = {
      x: marginX + index * (colW + gapX),
      y: outfitCardsY - profileScroll,
      w: colW,
      h: styleH,
    };
    drawProfileStyleCard(rect, option, '#FF28CC');
  });
  ctx.restore();
  drawProfileSaveButton(saveY, saveH);
  text('Deslizá para ver todas las opciones', W / 2, saveY - 3 * U, 8, '#d9e9ff');
  drawBottomNav(2);
}

function drawAwards() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.6)';
  ctx.fillRect(0, 0, W, H);
  title('PREMIOS', W / 2, H * 0.08, 28);
  text(`Tenés ${totalPoints} puntos en total`, W / 2, H * 0.125, 15, '#4df0ff');
  AWARDS.forEach((a, i) => {
    const y = H * (0.15 + i * 0.077);
    const got = totalPoints >= a.min;
    ctx.globalAlpha = got ? 1 : 0.45;
    panel(W * 0.07, y, W * 0.86, H * 0.066, got ? 0.75 : 0.45);
    text(a.icon, W * 0.14, y + H * 0.044, 22);
    text(a.name, W * 0.22, y + H * 0.03, 16, got ? '#ffe14d' : '#fff', 'left');
    text(got ? '¡Desbloqueado!' : `${a.min} pts`, W * 0.22, y + H * 0.055, 11, got ? '#5cf28a' : '#ccc', 'left');
    ctx.globalAlpha = 1;
  });
  drawBottomNav(4);
}

function drawRanking() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.6)';
  ctx.fillRect(0, 0, W, H);
  title('RANKING', W / 2, H * 0.08, 28);
  const tabs = ['Dirigir', 'Ritmo', 'Sinfónico', 'Rosco'];
  tabs.forEach((t, i) => button(t, W * (0.04 + i * 0.23), H * 0.11, W * 0.22, H * 0.05, () => { rankingTab = i; }, rankingTab === i ? '#ff3d7f' : '#3a3a6a', 11));
  const key = GAMES[rankingTab].key;
  const list = ranking.filter((r) => r.game === key).slice(0, 10);
  const me = ranking.filter((r) => r.game === key && r.name === playerName)[0];
  list.forEach((r, i) => {
    const y = H * (0.19 + i * 0.062);
    const mine = r.name === playerName;
    const rowX = W * 0.05;
    const rowW = W * 0.9;
    const rowH = H * 0.054;
    panel(rowX, y, rowW, rowH, mine ? 0.85 : 0.5);
    if (i < 3) {
      const podiumColors = ['#FFD52B', '#DCE7F2', '#E59B65'];
      ctx.save();
      ctx.shadowColor = podiumColors[i];
      ctx.shadowBlur = 8 * U;
      ctx.strokeStyle = podiumColors[i];
      ctx.lineWidth = 1.8 * U;
      ctx.beginPath(); ctx.roundRect(rowX, y, rowW, rowH, 11 * U); ctx.stroke();
      ctx.restore();
    }
    text(['🥇', '🥈', '🥉'][i] || `${i + 1}.`, W * 0.1, y + H * 0.036, 15);
    avatarBadge(r.avatar || 0, W * 0.2, y + H * 0.027, H * 0.045);
    text(r.name, W * 0.27, y + H * 0.024, 14, mine ? '#ffe14d' : '#fff', 'left');
    text(String(r.score), W * 0.91, y + H * 0.036, 16, '#4df0ff', 'right');
  });
  if (!list.length) text(rankingLive ? 'Todavía nadie jugó. ¡Ganá el primer puesto!' : 'Sin ranking guardado todavía. Conectate para verlo.', W / 2, H * 0.3, 14);
  text(me ? `Tu mejor marca online: ${me.score}` : '¡Jugá para entrar al ranking!', W / 2, H * 0.83, 13, '#ffe14d');
  if (!rankingLive) {
    const when = rankingSavedAt ? new Date(rankingSavedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    text(when ? `⚪ Sin conexión · ranking del ${when}, puede estar desactualizado` : '⚪ Sin conexión · ranking no disponible', W / 2, H * 0.862, 9.5, '#cfd6ff');
    const pending = syncQueue.state().unsynced;
    text(`Tu récord local: ${best[key] || 0}${pending ? ` · ${pending} puntaje${pending === 1 ? '' : 's'} esperando sincronizar` : ''}`, W / 2, H * 0.89, 9.5, '#ffe9a8');
  }
  drawBottomNav(3);
}

function drawClassMenu() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.62)'; ctx.fillRect(0, 0, W, H);
  title('CLASE MUSICAL', W / 2, H * 0.075, 24);
  text('Historia musical · instrumentos · lenguaje · ritmos argentinos', W / 2, H * 0.12, 11, '#4df0ff');
  drawFit(CHARACTERS[0].img, W * 0.86, H * 0.22, H * 0.14, Math.sin(time * 3) * 3);
  const colors = ['#3e6075', '#45697d', '#3b526d', '#536275', '#3d6870', '#405b70'];
  const saved = readStoredJSON('oefv-lessons', {}, isPlainObject);
  const gapX = W * 0.025;
  const cardW = (W * 0.91 - gapX) / 2;
  const cardH = H * 0.095;
  LESSONS.forEach((lessonDef, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = W * 0.045 + col * (cardW + gapX);
    const y = H * (0.27 + row * 0.115);
    const stars = saved[i] ? `  ${'★'.repeat(Math.min(3, saved[i]))}` : '';
    button(`${lessonDef.icon} ${lessonDef.title}${stars}`, x, y, cardW, cardH, () => startLesson(i), colors[i], 12);
  });
  text('Sebastián, el zorro director, te acompaña en cada reto.', W / 2, H * 0.69, 12, '#ffe14d');
  button('🎻 CONOCÉ TU INSTRUMENTO', W * 0.12, H * 0.76, W * 0.76, H * 0.075, () => { selectedGuideInstrument = -1; scene = 'instrument-guide'; }, '#34566a', 16);
  drawBottomNav(-1);
}

function drawGuideParagraph(str, x, y, maxWidth, lineHeight, size, color = '#fff', maxLines = 8) {
  ctx.font = `700 ${size * U}px ${FONT}`;
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((part, index) => text(part, x, y + index * lineHeight * U, size, color, 'left'));
  return y + Math.min(lines.length, maxLines) * lineHeight * U;
}

function drawGuideInstrumentImage(img, cx, cy, maxW, maxH) {
  if (!img?.complete || !img.naturalWidth) return;
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  ctx.drawImage(img, cx - width / 2, cy - height / 2, width, height);
}

function drawInstrumentGuide() {
  drawCover(STAGES[2].img);
  ctx.fillStyle = 'rgba(8,12,24,0.68)';
  ctx.fillRect(0, 0, W, H);
  const selected = INSTRUMENTS[selectedGuideInstrument];
  if (!selected) {
    title('CONOCÉ TU INSTRUMENTO', W / 2, H * 0.075, 21);
    text('Elegí un instrumento de la orquesta', W / 2, H * 0.12, 12, '#4df0ff');
    const gap = W * 0.022;
    const cardW = (W * 0.91 - gap * 2) / 3;
    const cardH = H * 0.135;
    INSTRUMENTS.forEach((instrument, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = W * 0.045 + col * (cardW + gap);
      const y = H * (0.19 + row * 0.15);
      buttons.push({ x, y, w: cardW, h: cardH, fn: () => { selectedGuideInstrument = index; } });
      panel(x, y, cardW, cardH, 0.78);
      drawGuideInstrumentImage(instrument.img, x + cardW / 2, y + cardH * 0.46, cardW * 0.72, cardH * 0.68);
      text(instrument.name, x + cardW / 2, y + cardH * 0.91, 11, '#fff');
    });
    button('Volver a clases', W * 0.2, H * 0.82, W * 0.6, H * 0.065, () => { scene = 'clase'; }, '#3a4bd8', 15);
    drawBottomNav(-1);
    return;
  }
  const guide = INSTRUMENT_GUIDE[selected.name] || { history: selected.clue, details: selected.clue };
  title(selected.name.toUpperCase(), W / 2, H * 0.075, 24);
  text(selected.family, W / 2, H * 0.12, 12, '#4df0ff');
  panel(W * 0.08, H * 0.15, W * 0.84, H * 0.18, 0.78);
  drawGuideInstrumentImage(selected.img, W / 2, H * 0.24, W * 0.62, H * 0.15);
  panel(W * 0.07, H * 0.35, W * 0.86, H * 0.41, 0.84);
  text('UN POCO DE HISTORIA', W * 0.12, H * 0.39, 13, '#ffe14d', 'left');
  const historyEnd = drawGuideParagraph(guide.history, W * 0.12, H * 0.42, W * 0.76, 15, 12, '#fff', 4);
  const headingY = Math.max(H * 0.52, historyEnd + 10 * U);
  text('¿CÓMO SE TOCA?', W * 0.12, headingY, 13, '#ffe14d', 'left');
  drawGuideParagraph(guide.details, W * 0.12, headingY + 23 * U, W * 0.76, 15, 12, '#fff', 8);
  button('← Instrumentos', W * 0.12, H * 0.775, W * 0.76, H * 0.055, () => { selectedGuideInstrument = -1; }, '#34566a', 15);
  button('Volver a clases', W * 0.2, H * 0.85, W * 0.6, H * 0.05, () => { scene = 'clase'; }, '#3a4bd8', 14);
  drawBottomNav(-1);
}

function drawLessonTriviaOption(index, label, selected, answer, onSelect) {
  const x = W * 0.055 + (index % 2) * W * 0.455;
  const y = H * 0.41 + Math.floor(index / 2) * H * 0.14;
  const w = W * 0.435;
  const h = H * 0.12;
  const state = answer === index ? 'correct' : selected === index ? 'wrong' : '';
  buttons.push({ x, y, w, h, fn: onSelect });
  ctx.fillStyle = state === 'correct' ? 'rgba(35,145,91,0.95)' : state === 'wrong' ? 'rgba(185,53,76,0.95)' : 'rgba(52,30,88,0.94)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 13 * U); ctx.fill();
  ctx.strokeStyle = state === 'correct' ? '#80ffad' : 'rgba(120,230,255,0.8)';
  ctx.lineWidth = 2 * U; ctx.stroke();
  wrappedText(label, x + w / 2, y + h / 2 + 5 * U, w * 0.82, 17, 13, '#fff');
}

function drawLesson() {
  const L = lesson.def;
  drawCover(STAGES[2].img);
  ctx.fillStyle = 'rgba(8,12,24,0.5)';
  ctx.fillRect(0, 0, W, H);
  button('✕', W * 0.04, H * 0.02, 44 * U, 38 * U, () => { scene = 'clase'; setMusicTrack(GAME_MUSIC.menu); }, '#333355', 16);
  title(L.title.toUpperCase(), W / 2, H * 0.085, 20);
  const bob = Math.sin(time * 4) * 4;
  if (L.type === 'trivia') {
    const totalQuestions = lesson.questions.length;
    const question = lesson.questions[lesson.questionOrder[lesson.round]];
    text(`${L.category} · ${lesson.round + 1}/${totalQuestions} · Sebastián pregunta`, W / 2, H * 0.14, 13, '#4df0ff');
    if (lesson.phase === 'trivia-question') {
      panel(W * 0.07, H * 0.2, W * 0.86, H * 0.17, 0.84);
      wrappedText(question.prompt, W / 2, H * 0.255, W * 0.76, 21, 15, '#fff');
      question.options.forEach((option, i) => drawLessonTriviaOption(
        i, option, -1, -1, () => answerTriviaLesson(i)
      ));
    } else if (lesson.phase === 'trivia-feedback') {
      title(lesson.answerCorrect ? '¡Correcto! ★' : '¡Buen intento!', W / 2, H * 0.24, 24, lesson.answerCorrect ? '#ffe14d' : '#ffb347');
      panel(W * 0.07, H * 0.3, W * 0.86, H * 0.3, 0.88);
      wrappedText(`${lesson.msg} ${question.fact}`, W / 2, H * 0.38, W * 0.76, 23, 17, '#fff');
      if (lesson.award) text(`Premio desbloqueado: ${lesson.award.icon} ${lesson.award.name}`, W / 2, H * 0.63, 13, '#ffe14d');
      button(lesson.round + 1 >= totalQuestions ? 'Ver resultado ▶' : 'Siguiente pregunta ▶', W * 0.14, H * 0.68, W * 0.72, H * 0.075, nextLessonRound, '#22c97a', 17);
    } else if (lesson.phase === 'done') {
      const stars = lesson.correct === totalQuestions ? 3 : lesson.correct >= totalQuestions / 2 ? 2 : lesson.correct > 0 ? 1 : 0;
      const saved = readStoredJSON('oefv-lessons', {}, isPlainObject);
      if (!saved[lesson.idx] || saved[lesson.idx] < stars) {
        saved[lesson.idx] = stars;
        storageSet('oefv-lessons', JSON.stringify(saved));
        saveProgressLocally();
      }
      drawFit(CHARACTERS[0].img, W / 2, H * 0.42, H * 0.23, -Math.abs(Math.sin(time * 5)) * 10);
      title('★'.repeat(stars) + '☆'.repeat(3 - stars), W / 2, H * 0.56, 32);
      text(`Acertaste ${lesson.correct} de ${totalQuestions} · +${lesson.correct * 100} pts`, W / 2, H * 0.62, 15);
      if (lesson.award) text(`Premio: ${lesson.award.icon} ${lesson.award.name}`, W / 2, H * 0.68, 13, '#ffe14d');
      button('Repetir trivia', W * 0.15, H * 0.72, W * 0.7, H * 0.07, () => startLesson(lesson.idx), '#8b5cff');
      button('Otras clases', W * 0.15, H * 0.81, W * 0.7, H * 0.07, () => { scene = 'clase'; }, '#3a4bd8');
    }
    button('Volver a clases', W * 0.25, H * 0.9, W * 0.5, H * 0.055, () => { scene = 'clase'; }, '#3a4bd8', 13);
    return;
  }
  if (L.type === 'history') {
    text(`Curiosidad ${lesson.idx + 1}/4 · Historia musical`, W / 2, H * 0.14, 13, '#4df0ff');
    if (lesson.phase === 'history-question') {
      drawFit(CHARACTERS[0].img, W / 2, H * 0.32, H * 0.17, bob);
      panel(W * 0.07, H * 0.38, W * 0.86, H * 0.12);
      wrappedText(L.prompt, W / 2, H * 0.43, W * 0.78, 22, 15, '#fff');
      L.options.forEach((option, i) => {
        const x = W * 0.08 + (i % 2) * W * 0.43;
        const y = H * 0.56 + Math.floor(i / 2) * H * 0.105;
        button(option, x, y, W * 0.41, H * 0.085, () => answerHistoryLesson(i), '#7046a8', 13);
      });
    } else {
      const correct = lesson.correct > 0;
      title(correct ? '¡Correcto! ★' : '¡Buen intento!', W / 2, H * 0.3, 25, correct ? '#ffe14d' : '#ffb347');
      panel(W * 0.08, H * 0.38, W * 0.84, H * 0.24);
      wrappedText(L.fact, W / 2, H * 0.46, W * 0.74, 20, 15, '#fff');
      text(lesson.msg, W / 2, H * 0.66, 12, '#4df0ff');
      button(lesson.idx < 3 ? 'Siguiente curiosidad ▶' : 'Empezar lenguaje musical ▶', W * 0.12, H * 0.75, W * 0.76, H * 0.075, nextHistoryLesson, '#22c97a', 17);
    }
    button('Volver a clases', W * 0.25, H * 0.87, W * 0.5, H * 0.06, () => { scene = 'clase'; }, '#3a4bd8', 14);
    return;
  }
  const total = L.patterns.length;
  text(lesson.phase === 'intro' || lesson.phase === 'done' ? 'Clase musical' : `Ejercicio ${lesson.round + 1}/${total}  ·  ✔ ${lesson.correct}`, W / 2, H * 0.125, 14, '#4df0ff');

  if (lesson.phase === 'intro') {
    drawFit(CHARACTERS[0].img, W / 2, H * 0.5, H * 0.24, bob);
    panel(W * 0.06, H * 0.53, W * 0.88, H * 0.2);
    wrappedText(L.intro, W / 2, H * 0.58, W * 0.8, 22, 14, '#fff');
    button('▶ Empezar clase', W * 0.15, H * 0.78, W * 0.7, H * 0.075, playLessonDemo, '#22c97a', 20);
    return;
  }
  if (lesson.phase === 'done') {
    drawFit(CHARACTERS[0].img, W / 2, H * 0.45, H * 0.24, -Math.abs(Math.sin(time * 5)) * 12);
    const stars = lesson.correct === total ? 3 : lesson.correct >= total / 2 ? 2 : lesson.correct > 0 ? 1 : 0;
    const saved = readStoredJSON('oefv-lessons', {}, isPlainObject);
    if (!saved[lesson.idx] || saved[lesson.idx] < stars) {
      saved[lesson.idx] = stars;
      storageSet('oefv-lessons', JSON.stringify(saved));
      saveProgressLocally();
    }
    title('★'.repeat(stars) + '☆'.repeat(3 - stars), W / 2, H * 0.52, 34);
    text(`Acertaste ${lesson.correct} de ${total} · +${lesson.correct * 100} pts`, W / 2, H * 0.58, 16);
    if (lesson.award) text(`¡NUEVO PREMIO! ${lesson.award.icon} ${lesson.award.name}`, W / 2, H * 0.63, 16, '#ffe14d');
    button('Repetir clase', W * 0.15, H * 0.7, W * 0.7, H * 0.07, () => startLesson(lesson.idx), '#8b5cff');
    button('Otras clases', W * 0.15, H * 0.79, W * 0.7, H * 0.07, () => { scene = 'clase'; }, '#3a4bd8');
    return;
  }

  // Cada ejemplo aparece sobre un pentagrama: negras/corcheas en ritmo, notas en melodía.
  const p = L.patterns[lesson.round];
  const rhythm = L.type === 'rhythm' || L.type === 'tango';
  const staffEvents = rhythm
    ? p.map((at) => ({ at, pitch: 1 }))
    : p.map((pitch, i) => ({ at: i, pitch }));
  const activeIndex = lesson.phase === 'demo' ? lesson.ev - 1 : -1;
  panel(W * 0.05, H * 0.15, W * 0.9, H * 0.22);
  drawStaffNotation(
    { x: W * 0.07, y: H * 0.155, w: W * 0.86, h: H * 0.205 },
    staffEvents,
    L.beats || 4,
    { rhythm, color: '#ffe14d', header: rhythm ? `${L.beats || 4}/4 · negra = 1 pulso · corcheas = 2 sonidos` : `${L.beats || 4}/4 · ARPEGIO · DO₄ · MI₄ · SOL₄ · DO₅`, activeIndex, pitchSteps: L.staffSteps, ledgerNotes: L.ledgerNotes, noteLabels: !rhythm }
  );
  text(rhythm ? 'TA = negra  ·  ti-ti = dos corcheas  ·  silencio = pausa' : 'Las notas suben y bajan sobre las líneas y espacios.', W / 2, H * 0.37, 10, '#fff');

  const phaseText = { demo: '👂 Escuchá el ejemplo…', turn: '👉 ¡Tu turno! Repetilo', feedback: lesson.msg };
  if (lesson.phase === 'feedback') {
    panel(W * 0.06, H * 0.37, W * 0.88, H * 0.16, 0.88);
    wrappedText(lesson.msg, W / 2, H * 0.425, W * 0.78, 22, 16, '#ffe14d');
  } else text(phaseText[lesson.phase], W / 2, H * 0.4, 18, lesson.phase === 'turn' ? '#5cf28a' : '#ffe14d');
  if (lesson.phase === 'turn') text('●'.repeat(lesson.taps.length) + '○'.repeat(Math.max(0, p.length - lesson.taps.length)), W / 2, H * 0.445, 18, '#fff');

  if (L.type === 'rhythm' || L.type === 'tango') {
    const r = W * 0.27 * (lesson.lit === 0 ? 1.08 : 1);
    const cx = W / 2;
    const cy = H * 0.66;
    buttons.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2, fn: () => lessonTap(0) });
    const g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, lesson.lit === 0 ? '#fff6b0' : '#ffd0e0');
    g.addColorStop(1, lesson.lit === 0 ? '#ff9a1f' : '#c2185b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 6 * U; ctx.stroke();
    text(L.type === 'tango' ? '🪗 TOCÁ' : '🥁 TOCÁ', cx, cy + 8 * U, 24);
  } else {
    const kw = W * 0.2;
    for (let i = 0; i < 4; i++) {
      const x = W * 0.06 + i * (kw + W * 0.027);
      const kh = H * 0.19;
      const y = H * (0.66 - i * 0.035);
      buttons.push({ x, y, w: kw, h: kh, fn: () => lessonTap(i) });
      ctx.fillStyle = lesson.lit === i ? '#ffffff' : NOTE_COLORS[i];
      ctx.beginPath(); ctx.roundRect(x, y, kw, kh, 14 * U); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3 * U; ctx.stroke();
      text(NOTE_NAMES[i], x + kw / 2, y + kh - 14 * U, 18);
    }
  }
  if (lesson.phase === 'feedback') {
    button(lesson.round + 1 >= total ? 'Ver resultado' : 'Siguiente ▶', W * 0.2, H * 0.89, W * 0.6, H * 0.065, nextLessonRound, '#22c97a');
  } else if (lesson.phase === 'turn') {
    button('↻ Escuchar de nuevo', W * 0.2, H * 0.89, W * 0.6, H * 0.065, playLessonDemo, '#3a4bd8', 16);
  }
}

function drawMeterSelect() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.45)';
  ctx.fillRect(0, 0, W, H);
  drawMovingLights();
  title('DIRIGIR', W / 2, H * 0.08, 28);
  text('Elegí compás, nivel y escenario', W / 2, H * 0.12, 14, '#4df0ff');
  [2, 3, 4].forEach((meter, i) => {
    const x = W * (0.06 + i * 0.3);
    button(`${meter}/4`, x, H * 0.15, W * 0.28, H * 0.07, () => { selectedMeter = meter; }, selectedMeter === meter ? '#ff3d7f' : '#3a3a6a', 20);
    text(meterLesson(meter).split(' · ')[1], x + W * 0.14, H * 0.25, 9, '#fff');
  });
  DIFFICULTY_ORDER.forEach((key, i) => {
    const x = W * (0.06 + i * 0.3);
    button(DIFFICULTIES[key].label, x, H * 0.28, W * 0.28, H * 0.065, () => { selectedDifficulty = key; }, selectedDifficulty === key ? '#8b5cff' : '#3a3a6a', 16);
  });
  drawStagePicker(H * 0.36);
  text('Seguí la figura con tu batuta: el 1 dorado marca el pulso fuerte.', W / 2, H * 0.545, 11, '#fff');
  drawConductorCoach(selectedMeter, W / 2, H * 0.765, H * 0.18);
  const rival = rivalFor('dirigir', best.dirigir || 0);
  if (rival) text(`🎯 Rival a superar: ${rival.name} (${rival.score})`, W / 2, H * 0.59, 11, '#ffe14d');
  button('▶ ¡A dirigir!', W * 0.15, H * 0.8, W * 0.7, H * 0.075, () => startGame(0), '#22c97a', 20);
  button('Volver', W * 0.3, H * 0.895, W * 0.4, H * 0.06, returnToMenu, '#3a4bd8', 16);
}

function drawDifficultySelect() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.45)';
  ctx.fillRect(0, 0, W, H);
  drawMovingLights();
  title(GAME_TITLES[pendingGameIndex].toUpperCase(), W / 2, H * 0.09, 17);
  text('Elegí nivel y escenario', W / 2, H * 0.13, 14, '#4df0ff');
  const help = ['Ritmo lento y notas separadas.', 'Más tiempo entre notas y pocas corcheas juntas.', 'Un desafío rápido con menos margen.'];
  DIFFICULTY_ORDER.forEach((key, i) => {
    const x = W * (0.06 + i * 0.3);
    button(DIFFICULTIES[key].label, x, H * 0.16, W * 0.28, H * 0.07, () => { selectedDifficulty = key; }, selectedDifficulty === key ? '#8b5cff' : '#3a3a6a', 17);
  });
  text(help[DIFFICULTY_ORDER.indexOf(selectedDifficulty)], W / 2, H * 0.27, 12);
  drawStagePicker(H * 0.33);
  drawFit(CHARACTERS[0].img, W / 2, H * 0.8, H * 0.26, Math.sin(time * 3) * 4);
  const key = GAMES[pendingGameIndex].key;
  const rival = rivalFor(key, best[key] || 0);
  text(rival ? `🎯 Rival a superar: ${rival.name} (${rival.score})` : '👑 ¡Sos el número 1! Defendé tu puesto', W / 2, H * 0.52, 12, '#ffe14d');
  button('▶ ¡A jugar!', W * 0.15, H * 0.83, W * 0.7, H * 0.075, () => startGame(pendingGameIndex), '#22c97a', 20);
  button('←', W * 0.04, H * 0.02, 44 * U, 38 * U, returnToMenu, '#333355', 16);
}

function toggleMute() {
  muted = !muted;
  if (muted) {
    music.pause();
    welcomeMusic.pause();
    escapeMusic.pause();
    welcomeState.audioStarted = false;
  } else if (scene === 'intro') startWelcomeAudio();
  else if (scene === 'salieri-runner' && !salieriRunner.paused && !salieriRunner.finished) startEscapeMusic();
  else if (!runnerLayout) music.play().catch(() => {});
}

function renamePlayer() {
  nameInput.value = playerName;
  nameModal.style.display = 'flex';
  requestAnimationFrame(() => nameInput.focus());
}

function drawRestSymbol(x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5 * U, size * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + size * 0.1, y - size * 0.55);
  ctx.lineTo(x - size * 0.08, y - size * 0.14);
  ctx.lineTo(x + size * 0.18, y + size * 0.08);
  ctx.lineTo(x - size * 0.1, y + size * 0.38);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x - size * 0.1, y + size * 0.48, size * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawStaffNotation(rect, events, beats, options = {}) {
  const mini = !!options.mini;
  const rhythm = !!options.rhythm;
  const lineGap = Math.max(2 * U, Math.min(6.5 * U, rect.h * 0.07));
  const centerY = rect.y + rect.h * 0.57;
  const left = rect.x + rect.w * 0.06;
  const right = rect.x + rect.w * 0.96;
  const noteStart = left + (mini ? Math.max(16 * U, rect.w * 0.12) : Math.max(31 * U, rect.w * 0.1));
  const noteEnd = right - 5 * U;
  const noteWidth = Math.max(1, noteEnd - noteStart);
  const size = mini ? 6.5 * U : 10 * U;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = mini ? 1.15 * U : 1.5 * U;
  for (let line = -2; line <= 2; line++) {
    const y = centerY + line * lineGap;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }
  ctx.fillStyle = options.color || '#fff';
  ctx.font = `${mini ? 20 : 34}px serif`;
  ctx.textAlign = 'left';
  ctx.fillText('𝄞', left + 1 * U, centerY + lineGap * 1.65);
  if (options.header) {
    text(options.header, rect.x + rect.w * 0.04, rect.y + rect.h * 0.18, mini ? 9 : 11, options.color || '#fff', 'left');
  } else {
    text(`${beats}/4`, rect.x + rect.w * 0.04, rect.y + rect.h * 0.18, mini ? 8 : 11, '#ffe14d', 'left');
  }

  const ordered = events.slice().sort((a, b) => a.at - b.at);
  const xAt = (beat) => noteStart + Math.max(0, Math.min(1, beat / beats)) * noteWidth;
  const yAt = (event) => {
    if (options.pitchSteps) return centerY + (options.pitchSteps[event.pitch] ?? 0) * lineGap;
    return centerY + (rhythm ? 0 : (1.5 - (event.pitch || 0)) * lineGap * 0.62);
  };

  if (rhythm) {
    let restCoveredUntil = -1;
    for (let slot = 0; slot < beats - 0.001; slot += 0.5) {
      if (slot < restCoveredUntil - 0.001 || ordered.some((event) => Math.abs(event.at - slot) < 0.02)) continue;
      const next = ordered.find((event) => event.at > slot + 0.01);
      const prev = ordered.filter((event) => event.at < slot - 0.01).pop();
      const previousGap = prev && next ? next.at - prev.at : 0;
      const previousDuration = prev ? (previousGap > 0 && previousGap <= 0.5 ? previousGap : 1) : 0;
      if (prev && slot < prev.at + previousDuration - 0.01) continue;
      const restLength = (next ? next.at : beats) - slot;
      if (restLength > 0.01 && Number.isInteger(slot) && restLength >= 0.95) {
        drawRestSymbol(xAt(slot + 0.5), centerY, size * 1.45, options.color || '#ffe14d');
        restCoveredUntil = slot + 1;
      } else if (restLength > 0.01 && restLength <= 0.55) {
        drawRestSymbol(xAt(slot + restLength / 2), centerY, size * 1.2, options.color || '#ffe14d');
        restCoveredUntil = slot + restLength;
      }
    }
  }

  ordered.forEach((event, index) => {
    if (index > options.revealThrough && options.revealThrough !== undefined) return;
    const x = xAt(event.at);
    const y = yAt(event);
    const active = index === options.activeIndex;
    const noteColor = active ? '#fff4a0' : (options.color || '#ffe14d');
    const gap = index + 1 < ordered.length ? ordered[index + 1].at - event.at : beats - event.at;
    const flags = rhythm && gap <= 0.27 ? 2 : rhythm && gap <= 0.55 ? 1 : 0;
    if (options.ledgerNotes?.includes(event.pitch)) {
      ctx.strokeStyle = noteColor;
      ctx.lineWidth = Math.max(1.4 * U, size * 0.18);
      ctx.beginPath(); ctx.moveTo(x - size * 1.7, y); ctx.lineTo(x + size * 1.7, y); ctx.stroke();
    }
    ctx.fillStyle = noteColor;
    ctx.beginPath(); ctx.ellipse(x, y, size, size * 0.68, -0.28, 0, Math.PI * 2); ctx.fill();
    const stemX = x + size * 0.72;
    const stemTop = y - lineGap * 2.45;
    ctx.strokeStyle = noteColor;
    ctx.lineWidth = Math.max(1.4 * U, size * 0.2);
    ctx.beginPath(); ctx.moveTo(stemX, y); ctx.lineTo(stemX, stemTop); ctx.stroke();
    for (let f = 0; f < flags; f++) {
      const fy = stemTop + f * lineGap * 0.4;
      ctx.beginPath();
      ctx.moveTo(stemX, fy);
      ctx.quadraticCurveTo(stemX + size * 1.7, fy + size * 0.65, stemX + size * 0.55, fy + size * 1.5);
      ctx.stroke();
    }
    if (options.noteLabels && !mini) {
      const noteName = NOTE_NAMES[Math.max(0, Math.min(3, event.pitch || 0))];
      const labelY = y > centerY ? y + lineGap * 1.55 : y - lineGap * 1.35;
      text(noteName, x, labelY, 9, '#aef6ff');
    }
    if (active) {
      ctx.strokeStyle = 'rgba(255,244,160,0.45)';
      ctx.lineWidth = 3 * U;
      ctx.beginPath(); ctx.arc(x, y, size * 1.9, 0, Math.PI * 2); ctx.stroke();
    }
  });
  ctx.restore();
}

function drawNotationOption(rect, option, index, onSelect) {
  buttons.push({ ...rect, fn: onSelect });
  ctx.fillStyle = 'rgba(20,8,45,0.78)';
  ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 13 * U); ctx.fill();
  ctx.strokeStyle = 'rgba(120,230,255,0.82)';
  ctx.lineWidth = 2 * U;
  ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 13 * U); ctx.stroke();
  text(`${index + 1}`, rect.x + 12 * U, rect.y + 16 * U, 10, '#4df0ff', 'left');
  let events;
  let beats;
  let rhythm;
  if (option.hits) {
    beats = option.beats;
    events = option.hits.map((at) => ({ at, pitch: 1 }));
    rhythm = true;
  } else if (option.pitches) {
    beats = 4;
    const levels = [...new Set(option.pitches)].sort((a, b) => a - b);
    events = option.pitches.map((pitch, i) => ({ at: i, pitch: levels.length < 2 ? 1 : Math.round((levels.indexOf(pitch) / (levels.length - 1)) * 3) }));
    rhythm = false;
  } else {
    beats = 4;
    events = Array.from({ length: option.value || 1 }, (_, i) => ({ at: i, pitch: 1 }));
    rhythm = true;
  }
  const notationRect = { x: rect.x + 3 * U, y: rect.y + 9 * U, w: rect.w - 6 * U, h: rect.h - 22 * U };
  drawStaffNotation(notationRect, events, beats, { mini: true, rhythm, color: '#ffe14d' });
  text(option.label, rect.x + rect.w / 2, rect.y + rect.h - 5 * U, 9, '#fff');
}

function drawSymphony(bob) {
  if (!st.question) {
    text('Sebastián prepara el próximo desafío…', W / 2, H * 0.48, 16, '#ffd84a');
    return;
  }
  text(`EPISODIO ${st.level}/7  ·  DESAFÍO ${st.questionIndex + 1}/${st.questionsPerEpisode}`, W / 2, H * 0.17, 16, '#ffd84a');
  text(st.question.topic, W / 2, H * 0.21, 12, '#fff');
  text('❤'.repeat(Math.max(0, st.lives)), W / 2, H * 0.25, 16, '#ff5a6e');
  drawFit(CHARACTERS[0].img, W / 2, H * 0.4, H * 0.12, bob);

  if (st.phase === 'preview') {
    text('Escuchá el ejemplo musical…', W / 2, H * 0.32, 16, '#ffd84a');
    button('↻ Repetir ejemplo', W * 0.2, H * 0.44, W * 0.6, H * 0.065, replaySymphonyExample, '#2d4a8a');
  } else if (st.phase === 'answer') {
    text(st.question.prompt, W / 2, H * 0.29, 15, '#ffd84a');
    if (st.question.instrument) text(`${st.question.instrument.name} · ${st.question.instrument.family}`, W / 2, H * 0.32, 11, '#fff');
    button('↻ Escuchar otra vez', W * 0.2, H * 0.36, W * 0.6, H * 0.055, replaySymphonyExample, '#2d4a8a');
    st.question.options.forEach((option, i) => {
      const r = optionRect(i);
      const musicalOption = st.question.rhythm || st.question.melody || option.value !== undefined;
      if (musicalOption) drawNotationOption(r, option, i, () => answerSymphony(i));
      else button(option.label, r.x, r.y, r.w, r.h, () => answerSymphony(i), '#863849', 15);
    });
  } else if (st.phase === 'feedback') {
    wrappedText(st.feedbackText, W / 2, H * 0.31, W * 0.88, 19, 14, '#fff');
    text('Preparando el próximo ejemplo…', W / 2, H * 0.49, 12, '#ffd84a');
  } else if (st.phase === 'episode-clear') {
    text(st.level === 7 ? '¡Orquesta completa!' : '¡Episodio superado!', W / 2, H * 0.32, 22, '#ffd84a');
    wrappedText('Escuchaste, comparaste y reconociste los patrones. ¿Listo para aumentar la dificultad?', W / 2, H * 0.39, W * 0.86, 20, 13, '#fff');
    button(st.level === 7 ? 'Finalizar' : 'Siguiente episodio', W * 0.14, H * 0.58, W * 0.72, H * 0.075, advanceSymphonyEpisode);
  }
}

function drawQuizOptionCard(index, label, state, onSelect, yBase = 0.49, rowStep = 0.14) {
  const x = W * 0.055 + (index % 2) * W * 0.455;
  const y = H * yBase + Math.floor(index / 2) * H * rowStep;
  const w = W * 0.435;
  const h = H * 0.12;
  const fill = state === 'correct' ? 'rgba(32,150,91,0.95)' : state === 'wrong' ? 'rgba(185,53,76,0.95)' : 'rgba(52,30,88,0.94)';
  buttons.push({ x, y, w, h, fn: onSelect });
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 14 * U); ctx.fill();
  ctx.strokeStyle = state === 'correct' ? '#80ffad' : state === 'wrong' ? '#ff9a9a' : 'rgba(120,230,255,0.8)';
  ctx.lineWidth = 2 * U; ctx.stroke();
  text(`${index + 1}`, x + 12 * U, y + 20 * U, 12, '#ffe14d', 'left');
  wrappedText(label, x + w / 2, y + h / 2 + 5 * U, w * 0.82, 17, 13, '#fff');
}

function drawQuizSetup() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.7)'; ctx.fillRect(0, 0, W, H);
  title(quizGameKey === 'rosco' ? 'ROSCO MUSICAL' : 'DESAFÍO SINFÓNICO', W / 2, H * 0.1, 21);
  text('Preguntas musicales · 4 opciones · sumá puntos', W / 2, H * 0.145, 12, '#4df0ff');
  let modeTitleY = 0.43;
  let modeButtonsY = 0.47;
  let actionY = 0.61;
  if (quizGameKey === 'rosco') {
    panel(W * 0.08, H * 0.22, W * 0.84, H * 0.16);
    wrappedText('Recorré las letras del rosco y elegí la respuesta correcta en cada desafío.', W / 2, H * 0.285, W * 0.72, 20, 15, '#fff');
  } else {
    text('Elegí un tópico', W / 2, H * 0.22, 15, '#ffe14d');
    QUIZ_TOPICS.forEach((topic, i) => {
      const x = W * 0.05 + i * W * 0.46;
      const w = W * 0.44;
      const y = H * 0.25;
      buttons.push({ x, y, w, h: H * 0.12, fn: () => { selectedQuizTopic = topic.key; } });
      ctx.fillStyle = selectedQuizTopic === topic.key ? '#36586c' : 'rgba(24,34,52,0.92)';
      ctx.beginPath(); ctx.roundRect(x, y, w, H * 0.12, 12 * U); ctx.fill();
      ctx.strokeStyle = selectedQuizTopic === topic.key ? '#8dd5df' : 'rgba(180,210,220,0.28)'; ctx.lineWidth = 2 * U; ctx.stroke();
      wrappedText(`${topic.icon} ${topic.label}`, x + w / 2, H * 0.302, w * 0.86, 16, 11, '#fff');
    });
    text('Dificultad', W / 2, H * 0.395, 13, '#ffe14d');
    QUIZ_DIFFICULTY_ORDER.forEach((key, i) => {
      const x = W * (0.05 + i * 0.305);
      button(QUIZ_DIFFICULTIES[key].label, x, H * 0.415, W * 0.285, H * 0.06,
        () => { selectedQuizDifficulty = key; }, selectedQuizDifficulty === key ? '#b34282' : '#3a3a6a', 13);
    });
    modeTitleY = 0.5;
    modeButtonsY = 0.535;
    actionY = 0.655;
  }
  text('¿Cómo querés jugar?', W / 2, H * modeTitleY, 15, '#ffe14d');
  button(selectedQuizMode === 'solo' ? '✓ En solitario' : 'En solitario', W * 0.08, H * modeButtonsY, W * 0.4, H * 0.075, () => { selectedQuizMode = 'solo'; }, selectedQuizMode === 'solo' ? '#22a86b' : '#3a4bd8', 15);
  button(selectedQuizMode === 'duel' ? '✓ Duelo online' : 'Duelo online', W * 0.52, H * modeButtonsY, W * 0.4, H * 0.075, () => { selectedQuizMode = 'duel'; }, selectedQuizMode === 'duel' ? '#22a86b' : '#3a4bd8', 15);
  if (selectedQuizMode === 'solo') {
    button('▶ ¡A jugar!', W * 0.15, H * actionY, W * 0.7, H * 0.08, startSelectedQuiz, '#ff3d7f', 20);
  } else {
    button('Crear / unirme a una sala', W * 0.12, H * actionY, W * 0.76, H * 0.08, startSelectedQuiz, '#ff3d7f', 17);
    text('Una persona crea una sala y comparte el código con su rival.', W / 2, H * (actionY + 0.105), 11, '#fff');
  }
  button('Volver', W * 0.3, H * 0.87, W * 0.4, H * 0.06, returnToMenu, '#3a4bd8');
}

function drawQuizRoom() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.72)'; ctx.fillRect(0, 0, W, H);
  title('DUELO MUSICAL', W / 2, H * 0.13, 25);
  text('¡Competí en tiempo real con otra cuenta!', W / 2, H * 0.19, 13, '#4df0ff');
  panel(W * 0.08, H * 0.27, W * 0.84, H * 0.13);
  wrappedText('Una persona crea una sala y comparte el código; la otra lo ingresa para unirse.', W / 2, H * 0.32, W * 0.72, 19, 14, '#fff');
  button('＋ Crear sala nueva', W * 0.12, H * 0.48, W * 0.76, H * 0.085, () => startDuelRoom(generateRoomCode(), true), '#ff3d7f', 18);
  button('🔑 Ingresar código', W * 0.12, H * 0.59, W * 0.76, H * 0.085, openRoomCodeEntry, '#3a4bd8', 18);
  if (duelError) wrappedText(duelError, W / 2, H * 0.73, W * 0.84, 18, 12, '#ff9a9a');
  button('Volver', W * 0.3, H * 0.86, W * 0.4, H * 0.065, () => { scene = 'quiz-setup'; }, '#555078');
}

function drawDuelLobby() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.72)'; ctx.fillRect(0, 0, W, H);
  title('SALA DE COMPETENCIA', W / 2, H * 0.11, 19);
  text(`Código: ${duel?.code || '—'}`, W / 2, H * 0.18, 25, '#ffe14d');
  text('Compartí este código con el otro jugador', W / 2, H * 0.22, 12, '#4df0ff');
  const players = duel?.players || [];
  players.slice(0, 4).forEach((player, i) => {
    const y = H * (0.32 + i * 0.085);
    panel(W * 0.13, y, W * 0.74, H * 0.068, 0.78);
    avatarBadge(player.avatar || 0, W * 0.23, y + H * 0.034, H * 0.05);
    text(player.name || 'Músico', W * 0.34, y + H * 0.043, 14, '#fff', 'left');
    text(player.role === 'host' ? 'ANFITRIÓN' : 'LISTO', W * 0.79, y + H * 0.043, 10, '#5cf28a', 'right');
  });
  if (players.length < 2) text('Esperando al segundo músico…', W / 2, H * 0.72, 14, '#ffe14d');
  else if (!duel?.isHost) text('¡Ya están los dos! Esperá a que el anfitrión comience.', W / 2, H * 0.72, 12, '#fff');
  else button('▶ ¡Comenzar duelo!', W * 0.14, H * 0.76, W * 0.72, H * 0.075, startDuelMatch, '#22c97a', 18);
  button('Salir de la sala', W * 0.22, H * 0.87, W * 0.56, H * 0.06, returnToMenu, '#3a4bd8', 14);
}

function drawRoscoWheel(spin, phase, results = {}) {
  const letters = ROSCO_LETTERS;
  const n = letters.length;
  const current = spin?.current || '?';
  const rotation = spin?.rotation || 0;
  // Ruleta mucho más grande: en giro ocupa el centro protagonista; al responder se acomoda arriba con gran legibilidad
  let big = 0;
  if (phase === 'spin' && spin) big = spin.elapsed < ROSCO_SPIN_TIME ? 1 : Math.max(0, 1 - (spin.elapsed - ROSCO_SPIN_TIME) / 0.7);
  const lerp = (a, b) => a + (b - a) * big;
  const cx = W / 2;
  const cy = lerp(H * 0.23, H * 0.40);
  const radius = Math.min(W * lerp(0.33, 0.43), H * lerp(0.12, 0.22));
  const k = radius / (H * 0.078);
  ctx.save();
  // Sombra y canto 3D del disco
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.ellipse(cx, cy + radius * 1.12, radius * 1.05, radius * 0.20, 0, 0, Math.PI * 2); ctx.fill();
  for (let d = 12; d > 0; d -= 2) {
    ctx.fillStyle = `rgb(${18 + d},${22 + d},${40 + d * 2})`;
    ctx.beginPath(); ctx.arc(cx, cy + d * U * k * 0.5, radius * 1.16, 0, Math.PI * 2); ctx.fill();
  }
  const disc = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.4, radius * 0.1, cx, cy, radius * 1.2);
  disc.addColorStop(0, '#2c3350'); disc.addColorStop(1, '#0d1020');
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#00DFFF'; ctx.lineWidth = (big > 0.5 ? 3 : 2) * U; ctx.stroke();
  // Sectores
  for (let i = 0; i < n; i++) {
    const a0 = (i - 0.5) / n * Math.PI * 2 + rotation - Math.PI / 2;
    const a1 = (i + 0.5) / n * Math.PI * 2 + rotation - Math.PI / 2;
    ctx.fillStyle = i % 2 ? 'rgba(77,240,255,0.09)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius * 1.12, a0, a1); ctx.closePath(); ctx.fill();
  }
  letters.forEach((letter, index) => {
    const angle = (index / n) * Math.PI * 2 + rotation - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const active = letter === current;
    const result = results?.[letter];
    const resultTop = result === true ? '#56d59a' : result === false ? '#ff7d83' : null;
    const resultBottom = result === true ? '#16845c' : result === false ? '#bd394e' : null;
    const r = (active ? 12 : 8.8) * U * Math.min(2.1, k * 0.78 + 0.22);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.arc(x, y + r * 0.25, r, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(x, y - r, x, y + r);
    g.addColorStop(0, resultTop || (active ? '#FF28CC' : '#3b4266'));
    g.addColorStop(1, resultBottom || (active ? '#B8124A' : '#1a1e33'));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = result !== undefined ? '#ffffff' : active ? '#FFD52B' : 'rgba(77,240,255,0.65)';
    ctx.lineWidth = (active ? 2.5 : 1.2) * U;
    ctx.stroke();
    text(letter, x, y + r * 0.36, (active ? 11 : 8.8) * Math.min(2.0, k * 0.78 + 0.22), '#fff');
  });
  // Centro
  const hubR = 26 * U * Math.min(2.0, k * 0.85 + 0.15);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(cx, cy + 4 * U, hubR, 0, Math.PI * 2); ctx.fill();
  const currentResult = results?.[current];
  const hub = ctx.createLinearGradient(cx, cy - hubR, cx, cy + hubR);
  hub.addColorStop(0, currentResult === true ? '#56d59a' : currentResult === false ? '#ff7d83' : '#2f3658');
  hub.addColorStop(1, currentResult === true ? '#16845c' : currentResult === false ? '#bd394e' : '#0e1122');
  ctx.fillStyle = hub;
  ctx.beginPath(); ctx.arc(cx, cy, hubR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#FFD52B'; ctx.lineWidth = 3 * U; ctx.stroke();
  title(current, cx, cy + hubR * 0.38, 30 * Math.min(2.0, k * 0.85 + 0.15), '#ffffff');
  // Puntero
  const py = cy - radius * 1.16;
  ctx.fillStyle = '#ff3d7f';
  ctx.beginPath();
  ctx.moveTo(cx, py + 14 * U);
  ctx.lineTo(cx - 12 * U, py - 12 * U);
  ctx.lineTo(cx + 12 * U, py - 12 * U);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * U; ctx.stroke();
  ctx.restore();
  if (big < 0.5) text(phase === 'spin' ? '¡GIRANDO!' : `LETRA ${current}`, cx, cy + radius * 1.16 + 15 * U, 11, '#4df0ff');
  else text(spin && spin.elapsed >= ROSCO_SPIN_TIME ? `¡Letra ${current}!` : 'Girando la ruleta…', cx, cy + radius * 1.16 + 28 * U, 19, '#FFD52B');
}

function drawQuizGame(bob) {
  const q = duel ? duel.question : st.question;
  if (!q) { text('Preparando la pregunta…', W / 2, H * 0.48, 18); return; }
  const isDuel = !!duel;
  const phase = isDuel ? duel.phase : st.phase;
  const round = isDuel ? duel.round : st.round;
  const total = isDuel ? duel.total : st.total;
  const topic = isDuel ? duel.topic : st.topic;
  const answered = isDuel ? duel.myAnswer !== null : phase !== 'question';
  const difficultyKey = isDuel ? duel.difficulty : selectedQuizDifficulty;
  const difficulty = QUIZ_DIFFICULTIES[difficultyKey] || QUIZ_DIFFICULTIES.medio;
  const difficultyTag = game.key === 'rosco' ? '' : ` · ${difficulty.label.toUpperCase()}`;
  const statusY = q.letter ? H * 0.15 : H * 0.18;
  text(isDuel ? `DUELO · ${duel.code} · ${round + 1}/${total}${difficultyTag}` : `${game.key === 'rosco' ? 'ROSCO MUSICAL' : QUIZ_TOPICS.find((item) => item.key === topic)?.label || 'Desafío musical'} · ${round + 1}/${total}${difficultyTag}`, W / 2, statusY, 12, '#4df0ff');
  const roscoPhase = q.letter ? phase : null;
  const roscoResults = isDuel ? duel.roscoResults : st.roscoResults;
  if (q.letter) drawRoscoWheel(isDuel ? duel.roscoSpin : st.roscoSpin, roscoPhase, roscoResults);
  const questionTop = q.letter ? 0.42 : 0.25;
  if (phase === 'spin') return;
  panel(W * 0.07, H * questionTop, W * 0.86, H * (q.letter ? 0.105 : 0.14), 0.83);
  wrappedText(q.prompt, W / 2, H * (questionTop + (q.letter ? 0.045 : 0.055)), W * 0.76, 20, 15, '#fff');
  if (phase === 'question' && (!isDuel || game.key === 'sinfonico')) {
    const timeLimit = isDuel ? (duel.timeLimit || 10) : st.timeLimit;
    const elapsed = isDuel ? duel.elapsed : st.qTime;
    const remaining = Math.max(0, 1 - elapsed / timeLimit);
    const timerY = q.letter ? H * 0.535 : H * 0.455;
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(W * 0.12, timerY, W * 0.76, 5 * U);
    ctx.fillStyle = '#ffe14d'; ctx.fillRect(W * 0.12, timerY, W * 0.76 * remaining, 5 * U);
    if (game.key === 'sinfonico') text(`${Math.max(0, Math.ceil(timeLimit - elapsed))} s`, W * 0.9, timerY - 5 * U, 10, '#ffe14d', 'right');
  }
  q.options.forEach((option, i) => {
    let state = '';
    let choose = () => {};
    if (!answered && phase === 'question') {
      choose = () => isDuel ? submitDuelAnswer(i) : answerSoloQuiz(i);
    } else if (phase === 'feedback') {
      const correctIndex = isDuel ? duel.correctIndex : q.answerIndex;
      state = i === correctIndex ? 'correct' : (isDuel ? i === duel.myAnswer : i === st.selectedAnswer) ? 'wrong' : '';
    }
    drawQuizOptionCard(i, option, state, choose, q.letter ? 0.555 : 0.49, q.letter ? 0.13 : 0.14);
  });
  if (isDuel && phase === 'question' && answered) {
    text('¡Respuesta enviada! Esperando al rival…', W / 2, H * 0.82, 14, '#ffe14d');
  } else if (phase === 'feedback') {
    const fact = isDuel ? duel.fact : q.fact;
    panel(W * 0.07, H * (q.letter ? 0.81 : 0.79), W * 0.86, H * (q.letter ? 0.14 : 0.15), 0.88);
    wrappedText(fact || (isDuel ? '¡Siguiente pregunta en breve!' : '¡Vamos con la próxima!'), W / 2, H * (q.letter ? 0.85 : 0.835), W * 0.78, 21, 15, '#ffe14d');
    if (isDuel) {
      const scores = duel.roundScores || [];
      if (scores.length) text(scores.map((player) => `${player.name}: ${player.score}`).join('   ·   '), W / 2, H * 0.93, 12, '#fff');
    }
  }
}

function drawPlay() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.3)';
  ctx.fillRect(0, 0, W, H);
  drawMovingLights();
  text(game.title + (st.quiz || duel ? '' : ' · ' + DIFFICULTIES[selectedDifficulty].label), W / 2, H * 0.06, 16, '#ffe14d');
  avatarBadge(profile.avatar, W * 0.09, H * 0.105, 30 * U);
  text(String(duel ? duel.score : score), W * 0.15, H * 0.115, 20, '#fff', 'left');
  if (combo > 1) text('🔥 x' + combo, W * 0.94, H * 0.115, 18, '#4df0ff', 'right');
  const rival = rivalFor(game.key, score);
  if (!duel && !st.quiz) text(rival ? `🎯 ${rival.name}: ${rival.score - score} pts para superarlo` : '👑 ¡Vas primero!', W / 2, H * 0.145, 11, '#ffe14d');
  button('✕', W * 0.03, H * 0.012, 40 * U, 34 * U, returnToMenu, '#333355', 15);
  const bob = Math.sin(time * 6) * 4;
  if (st.quiz || duel) { drawQuizGame(bob); return; }

  if (game.key === 'dirigir') {
    drawConductorStage();
    drawConductorHud();
  } else if (game.key === 'reconocer') {
    drawFit(CHARACTERS[0].img, W * 0.2, H * 0.38, H * 0.2, bob);
    text('Ronda ' + st.round + '/12 · escuchá y elegí', W * 0.62, H * 0.22, 16);
    button('🔁 Escuchar timbre', W * 0.42, H * 0.26, W * 0.48, H * 0.065, () => playTone(st.answer, 1.3), '#2d4a8a');
    st.options.forEach((o, i) => {
      let hl = null;
      if (st.answered >= 0) {
        if (o === st.answer) hl = '#7ee08a';
        else if (i === st.answered) hl = '#ff7b7b';
      }
      drawIconCard(optionRect(i), o, hl, true);
    });
    if (st.feedback) {
      panel(W * 0.06, H * 0.77, W * 0.88, H * 0.16, 0.82);
      wrappedText(st.feedback, W / 2, H * 0.82, W * 0.78, 21, 15, '#ffe14d');
    }
    else text('Pista: prestá atención al timbre y a la familia.', W / 2, H * 0.83, 12);
  } else if (game.key === 'ritmo') {
    drawFit(CHARACTERS[0].img, W * 0.91, H * 0.33, H * 0.13, bob);
    const lineY = H * 0.75;
    const interval = Math.max(selectedDifficulty === 'dificil' ? 0.48 : 0.62, 1.32 - st.level * 0.065) * DIFFICULTIES[selectedDifficulty].rhythmSpawn;
    const difficultyLabel = DIFFICULTIES[selectedDifficulty].label.toUpperCase();
    text(`NIVEL ${st.level} · ${difficultyLabel} · ${Math.round(60 / interval)} BPM`, W / 2, H * 0.18, 15, selectedDifficulty === 'dificil' ? '#ff667d' : '#ffd84a');
    text(selectedDifficulty === 'dificil' ? 'MODO DIFÍCIL · acelera de a poco y suma pocas notas juntas' : '♪ = corchea (medio pulso) · tocá cuando llegue al aro de su cuerda.', W / 2, H * 0.22, 11);
    const horizonY = H * 0.15;
    const roadBottom = lineY + 6 * U;
    // Solo las 4 líneas de las notas (cuerdas SOL, RE, LA, MI).
    for (let i = 0; i < 4; i++) {
      const lineCenterTop = W / 2 + (lanesX(i) - W / 2) * 0.18;
      ctx.strokeStyle = ['#ff5a6e', '#6ee7ff', '#7ee08a', '#ffb347'][i];
      ctx.lineWidth = 3 * U;
      ctx.beginPath(); ctx.moveTo(lineCenterTop, horizonY); ctx.lineTo(lanesX(i), roadBottom); ctx.stroke();
    }
    ctx.fillStyle = '#ffd84a';
    ctx.shadowColor = '#ffd84a'; ctx.shadowBlur = 12 * U;
    ctx.fillRect(W * 0.08, lineY - 3, W * 0.84, 6);
    ctx.shadowBlur = 0;
    for (let lane = 0; lane < 4; lane++) {
      const targetX = lanesX(lane);
      const targetColor = ['#ff5a6e', '#6ee7ff', '#7ee08a', '#ffb347'][lane];
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = 2 * U;
      ctx.beginPath(); ctx.moveTo(targetX, lineY - 13 * U); ctx.lineTo(targetX, lineY + 16 * U); ctx.stroke();
      ctx.strokeStyle = targetColor;
      ctx.lineWidth = 2.5 * U;
      ctx.beginPath(); ctx.arc(targetX, lineY, 13 * U, 0, Math.PI * 2); ctx.stroke();
    }
    st.notes.forEach((n) => {
      const depth = Math.max(0, Math.min(1, (n.y - horizonY) / (lineY - horizonY)));
      const x = W / 2 + (lanesX(n.lane) - W / 2) * depth;
      const size = (0.38 + depth * 0.68) * U;
      const color = ['#ff5a6e', '#6ee7ff', '#7ee08a', '#ffb347'][n.lane];
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(x + 3 * size, n.y + 7 * size, 27 * size, 16 * size, -0.12, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = color; ctx.shadowBlur = 12 * U * depth;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(x, n.y, 25 * size, 16 * size, -0.18, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.96)'; ctx.lineWidth = Math.max(2 * U, 3 * size);
      ctx.beginPath(); ctx.ellipse(x, n.y - 2 * size, 25 * size, 16 * size, -0.18, Math.PI * 1.08, Math.PI * 1.83); ctx.stroke();
      const stemX = x + 17 * size;
      const flagY = n.y - 34 * size;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(3 * U, 5 * size); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(stemX, n.y - 1 * size); ctx.lineTo(stemX, flagY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(stemX, flagY); ctx.quadraticCurveTo(x + 42 * size, n.y - 28 * size, x + 29 * size, n.y - 16 * size); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5 * U, 2.4 * size);
      ctx.beginPath(); ctx.moveTo(stemX, flagY); ctx.quadraticCurveTo(x + 42 * size, n.y - 28 * size, x + 29 * size, n.y - 16 * size); ctx.stroke();
    });
    const noteNames = ['SOL', 'RE', 'LA', 'MI'];
    const laneColors = ['#a92f45', '#28739b', '#368454', '#a35b22'];
    const buttonWidth = W * 0.19;
    const buttonGap = W * 0.02;
    for (let i = 0; i < 4; i++) {
      button(noteNames[i], W * 0.09 + i * (buttonWidth + buttonGap), H * 0.84, buttonWidth, H * 0.105, () => hitRhythmLane(i), laneColors[i]);
    }
    text('❤'.repeat(Math.max(0, st.lives)), W * 0.95, H * 0.17, 16, '#ff5a6e', 'right');
    text('Mirá el color de cada cuerda y el aro: ahí aterriza su corchea.', W / 2, H * 0.8, 10, '#e8f4f6');
  } else if (game.key === 'sinfonico') {
    if (st.phase === 'story') {
      drawFit(CHARACTERS[0].img, W / 2, H * 0.67, H * 0.22, bob);
      text(`EPISODIO ${st.level}/7  ·  DESAFÍO ${st.questionIndex + 1}/${st.questionsPerEpisode}`, W / 2, H * 0.18, 16, '#ffd84a');
      text(st.question.topic, W / 2, H * 0.22, 12, '#fff');
      wrappedText('Sebastián: ' + st.story, W / 2, H * 0.39, W * 0.88, 19, 13, '#fff');
      button('Escuchar ejemplo', W * 0.16, H * 0.76, W * 0.68, H * 0.08, beginSymphonyExample);
    } else {
      drawSymphony(bob);
    }
  }
}

function drawResult() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.55)';
  ctx.fillRect(0, 0, W, H);
  drawFit(AVATARS[profile.avatar].img, W / 2, H * 0.5, H * 0.2, -Math.abs(Math.sin(time * 5)) * 15);
  title('¡BRAVO!', W / 2, H * 0.1, 36);
  text(game.title, W / 2, H * 0.145, 16, '#4df0ff');
  title(score + ' PTS', W / 2, H * 0.205, 28, '#ffffff');
  text(`Récord: ${best[game.key]}  ·  Puesto #${lastRankPos} del ranking`, W / 2, H * 0.245, 13, '#ffe14d');
  if (lastNewAward) {
    panel(W * 0.1, H * 0.26, W * 0.8, H * 0.04, 0.8);
    text(`¡NUEVO PREMIO! ${lastNewAward.icon} ${lastNewAward.name}`, W / 2, H * 0.287, 14, '#ffe14d');
  }
  if (duel?.finalScores?.length) {
    const sortedScores = [...duel.finalScores].sort((a, b) => b.score - a.score);
    const tied = sortedScores.length > 1 && sortedScores[0].score === sortedScores[1].score;
    panel(W * 0.1, H * 0.34, W * 0.8, H * 0.14, 0.82);
    text(tied ? '¡EMPATE MUSICAL!' : sortedScores[0]?.playerId === localPlayerId ? '¡GANASTE EL DUELO! 🏆' : '¡EL RIVAL SE LLEVÓ ESTA!', W / 2, H * 0.385, 16, '#ffe14d');
    text(sortedScores.slice(0, 2).map((player) => `${player.name}: ${player.score} pts`).join('  ·  '), W / 2, H * 0.445, 12, '#fff');
  }
  const top = ranking.filter((r) => r.game === game.key).slice(0, 4);
  top.forEach((r, i) => {
    const y = H * (0.55 + i * 0.038);
    avatarBadge(r.avatar || 0, W * 0.2, y - 5 * U, 22 * U);
    text(`${['🥇', '🥈', '🥉', '4.'][i]} ${r.name}`, W * 0.26, y, 14, r.name === playerName ? '#ffe14d' : '#fff', 'left');
    text(String(r.score), W * 0.85, y, 14, '#4df0ff', 'right');
  });
  if (score >= 100 && gamesWon >= 4 && gamesWon % 4 === 0 && !orchestraPromptOpenedForResult) {
    drawNeonPanel(W * 0.17, H * 0.67, W * 0.66, H * 0.045, '#FFD52B', 'rgba(73,17,145,0.96)', 'rgba(17,20,67,0.98)');
    text('🎻 Conocé la Orquesta Escuela real', W / 2, H * 0.701, 10.5, '#FFD52B');
    buttons.push({ x: W * 0.17, y: H * 0.665, w: W * 0.66, h: H * 0.07, fn: () => openOrchestraInfo('result') });
  }
  button('🔁 Revancha', W * 0.15, H * 0.74, W * 0.7, H * 0.07, () => startGame(GAMES.indexOf(game)), '#ff3d7f');
  button('Menú', W * 0.15, H * 0.83, W * 0.7, H * 0.07, returnToMenu, '#3a4bd8');
  if (Math.random() < 0.3) {
    particles.push({ x: Math.random() * W, y: -10, vx: 0, vy: 80, life: 1.5, c: ['#ffd84a', '#ff5a6e', '#6ee7ff'][Math.floor(Math.random() * 3)] });
  }
}

// Título animado, con letras de varios colores, contorno oscuro y extrusión 3D.
function animatedTitle(str, x, y, size, color, maxW) {
  ctx.save();
  const localized = localizedFit(str, size, (s) => `${s * U}px ${TITLE_FONT}`);
  str = localized.str;
  let fontSize = localized.size * U;
  ctx.font = `${fontSize}px ${TITLE_FONT}`;
  const measured = ctx.measureText(str).width;
  if (maxW && measured > maxW) {
    fontSize *= maxW / measured;
    ctx.font = `${fontSize}px ${TITLE_FONT}`;
  }
  const totalWidth = ctx.measureText(str).width;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const bob = Math.sin(time * 1.2) * U;
  for (let depth = 6; depth > 0; depth--) {
    ctx.fillStyle = depth > 2 ? '#111827' : '#263649';
    ctx.fillText(str, x + depth * U * 0.48, y + bob + depth * U);
  }
  ctx.strokeStyle = 'rgba(5,10,18,0.98)';
  ctx.lineWidth = 5 * U;
  ctx.strokeText(str, x, y + bob);
  const palette = ['#ffd84a', '#ff705f', '#62dcff', '#b59aff', '#73e09a', '#ff9cca'];
  const characters = Array.from(str);
  const startX = x - totalWidth / 2;
  ctx.textAlign = 'left';
  characters.forEach((character, index) => {
    const before = ctx.measureText(characters.slice(0, index).join('')).width;
    ctx.fillStyle = palette[index % palette.length] || color;
    ctx.fillText(character, startX + before, y + bob);
  });
  ctx.restore();
}

const WELCOME_DIALOGS = [
  '¡Bienvenidos a nuestra Orquesta Escuela!',
];

function welcomeRevealDuration(slide = welcomeState.slide) {
  const phrase = WELCOME_DIALOGS[Math.min(slide, WELCOME_DIALOGS.length - 1)];
  return phrase.length / 30 + 0.15;
}

function advanceWelcome() {
  if (welcomeState.slide >= WELCOME_DIALOGS.length) return;
  if (welcomeState.slideElapsed < welcomeRevealDuration()) {
    welcomeState.slideElapsed = welcomeRevealDuration();
    return;
  }
  welcomeState.slide = Math.min(WELCOME_DIALOGS.length, welcomeState.slide + 1);
  welcomeState.slideElapsed = 0;
}

function welcomeBackgroundCrop() {
  const img = SCHOOL_BACKGROUND;
  let sourceW = img.naturalWidth;
  let sourceH = img.naturalHeight;
  if (sourceW / sourceH > W / H) sourceW = sourceH * W / H;
  else sourceH = sourceW * H / W;
  const sx = (img.naturalWidth - sourceW) / 2;
  const focusY = img.naturalHeight * (welcomePortraitLayout ? 0.38 : 0.32);
  const sy = Math.max(0, Math.min(img.naturalHeight - sourceH, focusY - sourceH / 2));
  return { sx, sy, sourceW, sourceH };
}

function drawWelcomeBackdrop() {
  const img = SCHOOL_BACKGROUND;
  if (!img.complete || !img.naturalWidth) {
    ctx.fillStyle = '#17274c'; ctx.fillRect(0, 0, W, H);
  } else {
    const crop = welcomeBackgroundCrop();
    ctx.drawImage(img, crop.sx, crop.sy, crop.sourceW, crop.sourceH, 0, 0, W, H);
  }
  const warmShade = ctx.createLinearGradient(0, 0, 0, H);
  warmShade.addColorStop(0, 'rgba(17,20,50,0.18)');
  warmShade.addColorStop(0.55, 'rgba(21,20,51,0.06)');
  warmShade.addColorStop(1, 'rgba(13,13,38,0.66)');
  ctx.fillStyle = warmShade; ctx.fillRect(0, 0, W, H);
  drawWelcomeMarqueeLogo(true);
  if (welcomePortraitLayout) {
    // En vertical: un velo suave detrás del botón, sin tapar al zorro.
    const m = welcomePortraitMetrics();
    const veilY = m.buttonY - 18 * U;
    const veil = ctx.createLinearGradient(0, veilY, 0, H);
    veil.addColorStop(0, 'rgba(25,17,54,0)');
    veil.addColorStop(0.35, 'rgba(25,17,54,0.32)');
    veil.addColorStop(1, 'rgba(13,13,38,0.55)');
    ctx.fillStyle = veil; ctx.fillRect(0, veilY, W, H - veilY);
    return;
  }
  ctx.fillStyle = 'rgba(25,17,54,0.30)';
  ctx.beginPath(); ctx.roundRect(W * 0.025, H * 0.68, W * 0.95, H * 0.32, 14 * U); ctx.fill();
}

// Distribución vertical de la bienvenida: cartel arriba, zorro al centro y botón abajo, sin superponerse.
function welcomePortraitMetrics() {
  const margin = Math.max(12, 16 * U);
  const skipH = Math.min(H * 0.06, 45 * U);
  const skipBottom = H * 0.035 + skipH;
  const titleSize = Math.max(16, Math.min(26, W * 0.065 / U));
  const subtitleSize = Math.max(10, Math.min(14, (W * 0.76) / (16 * U)));
  const panelX = Math.max(margin, W * 0.06);
  const panelW = W - panelX * 2;
  const panelY = skipBottom + 10 * U;
  const titleY = panelY + 14 * U + titleSize * U;
  const subtitleY = titleY + 12 * U + subtitleSize * U;
  const panelH = subtitleY + 14 * U - panelY;
  const buttonH = Math.max(56, Math.min(H * 0.09, 84 * U));
  const buttonW = Math.min(W * 0.86, 440 * U);
  const buttonX = (W - buttonW) / 2;
  const buttonY = H - margin - buttonH - 6 * U;
  const buttonFont = Math.max(10, Math.min(15, (buttonW * 0.8) / (15 * U)));
  const img = CHARACTERS[0].img;
  const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1096 / 1488;
  // Usa el mismo recorte del fondo que el logo para mantener al zorro debajo del cartel institucional.
  const bg = SCHOOL_BACKGROUND;
  const crop = welcomeBackgroundCrop();
  const signBottomY = bg.naturalHeight
    ? ((bg.naturalHeight * 0.357 - crop.sy) / crop.sourceH) * H
    : H * 0.357;
  const zoneTop = Math.max(panelY + panelH, signBottomY) + 14 * U;
  // El límite inferior queda antes del botón y de su área táctil.
  const zoneBottom = buttonY - Math.max(18 * U, 14);
  // El zorro se ajusta al espacio libre entre el cartel/logo y el botón, sin forzar un mínimo que provoque solapamientos.
  const foxH = Math.max(0, Math.min(zoneBottom - zoneTop, (W * 0.48) / aspect, H * 0.42));
  // Centrado verticalmente dentro de su franja para que los márgenes queden equilibrados.
  const foxBottom = zoneBottom - Math.max(0, (zoneBottom - zoneTop - foxH) / 2);
  return {
    panelX, panelY, panelW, panelH, titleY, subtitleY, titleSize, subtitleSize,
    buttonX, buttonY, buttonW, buttonH, buttonFont, foxBottom, foxH, aspect,
  };
}

// Distribución horizontal: cartel arriba al centro, zorro a la izquierda y botón a la derecha.
function welcomeLandscapeMetrics() {
  const margin = Math.max(10, Math.min(W * 0.03, 28 * U));
  const skipW = Math.min(W * 0.14, 120 * U);
  const skipH = Math.max(32, Math.min(H * 0.09, 43 * U));
  const skipX = W - skipW - margin;
  const skipY = Math.max(6, H * 0.035);
  const titleMaxW = Math.min(W * 0.56, (skipX - W / 2) * 2 - 16 * U);
  const titleY = skipY + skipH * 0.5 + 18 * U * 0.4 + H * 0.04;
  const subtitleY = titleY + 22 * U;
  const img = CHARACTERS[0].img;
  const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1096 / 1488;
  // CSS landscape-only ratios keep the fox entirely left of the school's sign.
  // This leaves the portrait metrics and its composition untouched.
  const landscapeStyles = getComputedStyle(container);
  const cssRatio = (name, fallback) => {
    const value = parseFloat(landscapeStyles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const foxLeft = W * cssRatio('--welcome-landscape-fox-left', 0.018);
  const foxMaxWidth = W * cssRatio('--welcome-landscape-fox-max-width', 0.22);
  const foxH = Math.min(H * 0.52, foxMaxWidth / aspect);
  const foxW = foxH * aspect;
  const foxCx = foxLeft + foxW / 2;
  const foxBottom = H - Math.max(4, H * cssRatio('--welcome-landscape-fox-bottom', 0.015));
  const buttonW = Math.max(170, Math.min(W * 0.38, W - (foxCx + foxW / 2) - margin * 2.5));
  const buttonH = Math.max(46, Math.min(H * 0.15, 82 * U));
  const buttonX = W - margin - buttonW;
  const buttonY = Math.min(H * 0.72, H - margin - buttonH - 6 * U);
  const buttonFont = Math.max(9, Math.min(13, (buttonW * 0.82) / (15 * U)));
  return {
    skipX, skipY, skipW, skipH, titleY, subtitleY, titleMaxW,
    foxCx, foxBottom, foxH, buttonX, buttonY, buttonW, buttonH, buttonFont,
  };
}

function drawWelcomeNotes() {
  const placements = welcomePortraitLayout
    ? [[0.07, 0.34], [0.93, 0.38], [0.06, 0.58], [0.94, 0.62], [0.9, 0.76]]
    : [[0.07, 0.23], [0.29, 0.12], [0.78, 0.12], [0.96, 0.29], [0.84, 0.70]];
  placements.forEach(([px, py], i) => {
    const y = H * py + Math.sin(time * 1.15 + i * 1.6) * 2.2 * U;
    ctx.globalAlpha = 0.66 + Math.sin(time * 1.4 + i) * 0.12;
    text(i % 2 ? '♫' : '♪', W * px, y, (11 + i % 3 * 2) * (welcomePortraitLayout ? 1 : 1), i % 2 ? '#8FE9FF' : '#FFE37A');
  });
  ctx.globalAlpha = 1;
}

function welcomeFoxLayout() {
  const portrait = welcomePortraitLayout;
  const pm = portrait ? welcomePortraitMetrics() : welcomeLandscapeMetrics();
  const foxH = pm.foxH;
  const cx = portrait ? W / 2 : pm.foxCx;
  const by = pm.foxBottom;
  const bob = Math.sin(time * (portrait ? 1.3 : 1.2)) * 0.25 * U;
  const img = CHARACTERS[0].img;
  const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1096 / 1488;
  const foxW = foxH * aspect;
  const pivotY = by - foxH * 0.5 + bob;
  const sway = drawFitSway(cx);
  const localHeadX = foxW * 0.34;
  const localHeadY = -foxH * 0.27;
  return {
    cx, by, foxH, bob,
    headX: cx + localHeadX * Math.cos(sway) - localHeadY * Math.sin(sway),
    headY: pivotY + localHeadX * Math.sin(sway) + localHeadY * Math.cos(sway),
  };
}

function drawWelcomeCast() {
  const fox = welcomeFoxLayout();
  drawFit(CHARACTERS[0].img, fox.cx, fox.by, fox.foxH, fox.bob);
}

function drawWelcomePanel(x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(6,5,28,0.2)'; ctx.shadowBlur = 9 * U; ctx.shadowOffsetY = 3 * U;
  const fill = ctx.createLinearGradient(x, y, x, y + h);
  fill.addColorStop(0, 'rgba(47,28,99,0.40)');
  fill.addColorStop(1, 'rgba(26,18,66,0.30)');
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 17 * U); ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(255,215,106,0.76)'; ctx.lineWidth = 1.8 * U; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.roundRect(x + 3 * U, y + 3 * U, w - 6 * U, Math.max(3 * U, h * 0.08), 10 * U); ctx.fill();
  ctx.restore();
}

function drawWelcomeMarqueeLogo(vivid = true) {
  if (!SCHOOL_BACKGROUND.complete || !SCHOOL_BACKGROUND.naturalWidth || !SCHOOL_LOGO.complete || !SCHOOL_LOGO.naturalWidth) return;
  const crop = welcomeBackgroundCrop();
  const mapX = (sourceX) => (sourceX - crop.sx) / crop.sourceW * W;
  const mapY = (sourceY) => (sourceY - crop.sy) / crop.sourceH * H;
  // These source-image bounds match the cream sign panel above the school entrance.
  const signLeft = mapX(SCHOOL_BACKGROUND.naturalWidth * 0.273);
  const signRight = mapX(SCHOOL_BACKGROUND.naturalWidth * 0.797);
  const signTop = mapY(SCHOOL_BACKGROUND.naturalHeight * 0.273);
  const signBottom = mapY(SCHOOL_BACKGROUND.naturalHeight * 0.357);
  const signW = signRight - signLeft;
  const signH = signBottom - signTop;
  const plaqueX = signLeft + signW * 0.035;
  const plaqueY = signTop + signH * 0.055;
  const plaqueW = signW * 0.93;
  const plaqueH = signH * 0.89;
  ctx.save();
  ctx.shadowColor = 'rgba(9,22,43,0.42)';
  ctx.shadowBlur = 5 * U;
  const plaque = ctx.createLinearGradient(plaqueX, plaqueY, plaqueX, plaqueY + plaqueH);
  plaque.addColorStop(0, 'rgba(24,44,72,0.97)');
  plaque.addColorStop(1, 'rgba(11,25,48,0.98)');
  ctx.fillStyle = plaque;
  ctx.beginPath(); ctx.roundRect(plaqueX, plaqueY, plaqueW, plaqueH, Math.min(6 * U, plaqueH * 0.14)); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,215,106,0.88)';
  ctx.lineWidth = 1.4 * U;
  ctx.stroke();
  ctx.restore();
  const logoW = Math.min(plaqueW * 0.91, plaqueH * 0.82 * 1536 / 771);
  const logoH = logoW * 771 / 1536;
  const lx = plaqueX + (plaqueW - logoW) / 2;
  const ly = plaqueY + (plaqueH - logoH) / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.shadowColor = 'rgba(26,44,68,0.24)';
  ctx.shadowBlur = 2 * U;
  drawSchoolLogoKeyed(lx, ly, logoW, logoH, vivid, false);
  ctx.restore();
}

function welcomeMessageLines(message, maxWidth, fontSize) {
  ctx.save();
  ctx.font = `800 ${fontSize * U}px ${FONT}`;
  const lines = [];
  let line = '';
  for (const word of message.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

function drawWelcomeMessage(message, x, y, maxWidth, fontSize, lineHeight) {
  message = t(message);
  ctx.save();
  ctx.font = `800 ${fontSize * U}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.4 * U;
  ctx.strokeStyle = 'rgba(16,12,42,0.88)';
  ctx.fillStyle = '#fff';
  welcomeMessageLines(message, maxWidth, fontSize).slice(0, 6).forEach((part, index) => {
    const baseline = y + index * lineHeight * U;
    ctx.strokeText(part, x, baseline);
    ctx.fillText(part, x, baseline);
  });
  ctx.restore();
}

function drawWelcomeDialogue() {
  const portrait = welcomePortraitLayout;
  if (portrait) {
    const m = welcomePortraitMetrics();
    drawWelcomePanel(m.panelX, m.panelY, m.panelW, m.panelH);
    animatedTitle('¡BIENVENIDOS!', W / 2, m.titleY, m.titleSize, '#FFD52B', m.panelW * 0.9);
    text('A NUESTRA ORQUESTA ESCUELA', W / 2, m.subtitleY, m.subtitleSize, '#fff');
    return;
  }
  const lm = welcomeLandscapeMetrics();
  animatedTitle('¡BIENVENIDOS!', W / 2, lm.titleY, 18, '#FFD52B', lm.titleMaxW);
  text('A NUESTRA ORQUESTA ESCUELA', W / 2, lm.subtitleY, 12, '#fff');
}

function drawWelcomeFinal() {
  const portrait = welcomePortraitLayout;
  const pm = portrait ? welcomePortraitMetrics() : welcomeLandscapeMetrics();
  const bw = pm.buttonW;
  const bh = pm.buttonH;
  const bx = pm.buttonX;
  const by = pm.buttonY;
  const radius = Math.min(bh * 0.28, 15 * U);
  const label = '▶  ¡COMENZAR LA AVENTURA!';
  const fontSize = pm.buttonFont;
  const hitH = Math.max(bh, 56);
  const hitY = Math.max(0, Math.min(H - hitH, by - (hitH - bh) / 2));
  const glow = 7 + Math.sin(time * 2.6) * 2.5;
  buttons.push({ x: bx, y: hitY, w: bw, h: hitH, fn: leaveIntro });
  ctx.save();
  ctx.shadowColor = 'rgba(255,215,106,0.82)';
  ctx.shadowBlur = glow * U;
  ctx.fillStyle = 'rgba(17,35,58,0.94)';
  ctx.beginPath(); ctx.roundRect(bx - 3 * U, by - 3 * U, bw + 6 * U, bh + 6 * U, radius + 3 * U); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#9A7540';
  ctx.beginPath(); ctx.roundRect(bx, by + 5 * U, bw, bh, radius); ctx.fill();
  const face = ctx.createLinearGradient(0, by, 0, by + bh);
  face.addColorStop(0, '#284866');
  face.addColorStop(0.5, '#173451');
  face.addColorStop(1, '#10263E');
  ctx.fillStyle = face;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, radius); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath(); ctx.roundRect(bx + 4 * U, by + 3 * U, bw - 8 * U, bh * 0.33, radius * 0.7); ctx.fill();
  ctx.shadowColor = '#FFD76D';
  ctx.shadowBlur = 4 * U;
  ctx.strokeStyle = '#E9C77F';
  ctx.lineWidth = 1.8 * U;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, radius); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(141,202,222,0.72)';
  ctx.lineWidth = 1 * U;
  ctx.beginPath(); ctx.roundRect(bx + 4 * U, by + 4 * U, bw - 8 * U, bh - 8 * U, Math.max(2 * U, radius - 3 * U)); ctx.stroke();
  ctx.restore();
  text(label, bx + bw / 2, by + bh / 2 + fontSize * 0.36 * U, fontSize, '#FFF0C8');
}

function drawWelcome() {
  drawWelcomeBackdrop();
  drawWelcomeCast();
  drawWelcomeNotes();
  drawWelcomeDialogue();
  drawWelcomeFinal();
  if (welcomePortraitLayout) {
    const skipW = W * 0.19;
    const skipH = Math.min(H * 0.06, 45 * U);
    button('SALTAR', W - skipW - W * 0.025, H * 0.035, skipW, skipH, leaveIntro, '#483879', 10.5);
  } else {
    const lm = welcomeLandscapeMetrics();
    button('SALTAR', lm.skipX, lm.skipY, lm.skipW, lm.skipH, leaveIntro, '#483879', 10.5);
  }
}

function openOrchestraInfo(returnScene = 'menu') {
  orchestraInfoReturnScene = ['result', 'missions'].includes(returnScene) ? returnScene : 'menu';
  orchestraInfoPage = 'welcome';
  invitationPendingUrl = '';
  welcomeLayout = false;
  invitationLayout = false;
  orchestraInfoLayout = true;
  scene = 'orchestra-info';
  if (returnScene === 'result') orchestraPromptOpenedForResult = true;
  resize();
}

function closeOrchestraInfo() {
  invitationPendingUrl = '';
  orchestraInfoLayout = false;
  scene = orchestraInfoReturnScene;
  if (scene === 'menu') currentNavItem = 0;
  resize();
}

function openOrchestraInvitation(returnScene = 'menu', markAsSeen = false) {
  invitationReturnScene = returnScene === 'result' ? 'result' : 'menu';
  invitationDialogIndex = 0;
  invitationElapsed = 0;
  invitationPendingUrl = '';
  particles = [];
  popups = [];
  welcomeLayout = false;
  invitationLayout = true;
  scene = 'orchestra-invite';
  if (markAsSeen) {
    storageSet(FIRST_CONCERT_INVITATION_KEY, 'true');
    saveProgressLocally();
  }
  resize();
  invitationConfetti = Array.from({ length: 90 }, () => ({
    x: Math.random() * W,
    y: -Math.random() * H * 0.9,
    vx: (Math.random() - 0.5) * 55,
    vy: 45 + Math.random() * 115,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 5,
    size: 4 + Math.random() * 7,
    life: 3.6 + Math.random() * 2.8,
    color: ['#FFD52B', '#FF28CC', '#00DFFF', '#5CF28A', '#FF705F', '#B59AFF'][Math.floor(Math.random() * 6)],
  }));
}

function closeOrchestraInvitation() {
  invitationPendingUrl = '';
  invitationLayout = false;
  scene = invitationReturnScene;
  if (scene === 'menu') currentNavItem = 0;
  resize();
}

function advanceOrchestraInvitation() {
  if (invitationDialogIndex < ORCHESTRA_INVITATION_MESSAGES.length) invitationDialogIndex++;
}

function requestOrchestraLink(url) {
  invitationPendingUrl = url;
}

function drawInvitationBackdrop() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#171044');
  sky.addColorStop(0.56, '#25205e');
  sky.addColorStop(1, '#0b1230');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 3; i++) {
    const topX = W * (0.12 + i * 0.38);
    const baseX = topX + Math.sin(time * 0.8 + i * 1.7) * W * 0.13;
    const beam = ctx.createLinearGradient(topX, 0, baseX, H * 0.84);
    beam.addColorStop(0, i === 1 ? 'rgba(255,213,43,0.24)' : 'rgba(0,223,255,0.2)');
    beam.addColorStop(1, 'rgba(255,40,204,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(topX - W * 0.025, 0);
    ctx.lineTo(topX + W * 0.025, 0);
    ctx.lineTo(baseX + W * 0.15, H * 0.82);
    ctx.lineTo(baseX - W * 0.15, H * 0.82);
    ctx.closePath();
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(W * 0.52, H * 0.83, 0, W * 0.52, H * 0.83, W * 0.54);
  glow.addColorStop(0, 'rgba(255,213,43,0.2)');
  glow.addColorStop(1, 'rgba(255,213,43,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, H * 0.35, W, H * 0.65);
  ctx.restore();

  const floor = ctx.createLinearGradient(0, H * 0.77, 0, H);
  floor.addColorStop(0, 'rgba(17,21,55,0)');
  floor.addColorStop(1, 'rgba(5,9,27,0.88)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, H * 0.77, W, H * 0.23);
  ctx.strokeStyle = 'rgba(255,213,43,0.38)';
  ctx.lineWidth = 2 * U;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.82);
  ctx.lineTo(W, H * 0.82);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const x = W * (0.06 + i * 0.125);
    const y = H * (0.2 + (i % 3) * 0.12) + Math.sin(time * 1.7 + i) * 4 * U;
    ctx.globalAlpha = 0.45 + Math.sin(time * 2 + i) * 0.18;
    text(i % 2 ? '♪' : '♫', x, y, 14, i % 2 ? '#00DFFF' : '#FFD52B');
  }
  ctx.globalAlpha = 1;
}

function drawInvitationConfetti() {
  invitationConfetti.forEach((piece) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, piece.life / 1.3));
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.rotation);
    ctx.fillStyle = piece.color;
    ctx.fillRect(-piece.size * U * 0.5, -piece.size * U * 0.28, piece.size * U, piece.size * U * 0.56);
    ctx.restore();
  });
  ctx.globalAlpha = 1;
}

function drawInvitationBubble() {
  const x = W * 0.39;
  const y = H * 0.19 + Math.sin(invitationElapsed * 2) * 2 * U;
  const w = W * 0.57;
  const h = H * 0.49;
  ctx.save();
  ctx.fillStyle = 'rgba(34,29,83,0.98)';
  ctx.strokeStyle = '#FFD52B';
  ctx.lineWidth = 2.4 * U;
  ctx.beginPath();
  ctx.moveTo(x + 8 * U, y + h * 0.57);
  ctx.lineTo(x - 19 * U, y + h * 0.69);
  ctx.lineTo(x + 12 * U, y + h * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawNeonPanel(x, y, w, h, '#FFD52B', 'rgba(47,35,104,0.98)', 'rgba(21,24,69,0.98)');
  const message = ORCHESTRA_INVITATION_MESSAGES[invitationDialogIndex];
  const fontSize = Math.min(18, Math.max(12, H * 0.025 / U));
  drawWelcomeMessage(message, x + w * 0.5, y + h * 0.32, w * 0.86, fontSize, fontSize * 1.3);
  text(`MENSAJE ${invitationDialogIndex + 1} DE ${ORCHESTRA_INVITATION_MESSAGES.length}`, x + w * 0.5, y + h * 0.14, 9.5, '#00DFFF');
  text('TOCÁ EL GLOBO PARA SEGUIR  ›', x + w * 0.5, y + h * 0.91, 10.5, '#FFD52B');
  buttons.push({ x, y, w, h, fn: advanceOrchestraInvitation });
}

function drawInvitationButton(label, x, y, w, h, fn, accent, fontSize = 12) {
  const hitW = Math.max(w, 48);
  const hitH = Math.max(h, 48);
  buttons.push({
    x: Math.max(0, Math.min(W - hitW, x - (hitW - w) / 2)),
    y: Math.max(0, Math.min(H - hitH, y - (hitH - h) / 2)),
    w: hitW,
    h: hitH,
    fn,
  });
  drawNeonPanel(x, y, w, h, accent, 'rgba(49,37,110,0.98)', 'rgba(19,22,66,0.98)');
  const size = Math.min(fontSize, Math.max(11, H * 0.018 / U));
  wrappedText(label, x + w / 2, y + h * 0.48, w * 0.88, size * 1.15, size, '#fff');
}

function drawOrchestraExternalWarning() {
  ctx.fillStyle = 'rgba(5,7,24,0.78)';
  ctx.fillRect(0, 0, W, H);
  const x = W * 0.15;
  const y = H * 0.18;
  const w = W * 0.7;
  const h = H * 0.65;
  drawNeonPanel(x, y, w, h, '#FFD52B', 'rgba(47,35,104,0.99)', 'rgba(18,21,62,0.99)');
  title('AVISO', W / 2, y + H * 0.14, 20, '#FFD52B');
  const note = 'Vas a salir del videojuego para visitar un sitio externo. No te pediremos ni guardaremos datos personales. Si sos menor de edad, pedí ayuda a una persona adulta responsable. ¿Querés continuar?';
  const fontSize = Math.min(15, Math.max(11, H * 0.022 / U));
  drawWelcomeMessage(note, W / 2, y + H * 0.31, w * 0.82, fontSize, fontSize * 1.25);
  const buttonY = y + H * 0.49;
  drawInvitationButton('Abrir enlace', x + w * 0.06, buttonY, w * 0.41, H * 0.12, () => {
    const url = invitationPendingUrl;
    invitationPendingUrl = '';
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, '#22A879', 13);
  drawInvitationButton('Ahora no', x + w * 0.53, buttonY, w * 0.41, H * 0.12, () => {
    invitationPendingUrl = '';
  }, '#465bd8', 13);
}

function drawOrchestraInvitation() {
  drawInvitationBackdrop();
  drawFit(CHARACTERS[0].img, W * 0.17, H * 0.94, H * 0.72, Math.sin(time * 2.2) * 3 * U);
  drawInvitationConfetti();
  animatedTitle('¡BRAVO, CONCERTISTA!', W * 0.65, H * 0.115, 23, '#FFD52B', W * 0.59);

  if (invitationPendingUrl) {
    drawOrchestraExternalWarning();
    return;
  }

  if (invitationDialogIndex < ORCHESTRA_INVITATION_MESSAGES.length) {
    drawInvitationBubble();
  } else {
    const x = W * 0.39;
    const y = H * 0.58;
    const w = W * 0.57;
    const h = H * 0.3;
    drawNeonPanel(x, y, w, h, '#00DFFF', 'rgba(47,35,104,0.98)', 'rgba(21,24,69,0.98)');
    text('¡LA MÚSICA NOS UNE!', x + w * 0.5, y + h * 0.29, 14, '#FFD52B');
    text('Elegí cómo conocer más de la orquesta:', x + w * 0.5, y + h * 0.49, 11, '#fff');
    drawInvitationButton('¡Quiero conocer la orquesta!', W * 0.39, H * 0.69, W * 0.27, H * 0.13,
      () => requestOrchestraLink('https://www.instagram.com/orquestaescuelaflorenciovarela/'), '#8B20F5', 12);
    drawInvitationButton('Ver nuestros conciertos', W * 0.69, H * 0.69, W * 0.27, H * 0.13,
      () => requestOrchestraLink('https://www.youtube.com/@orquestaescuelafciovarel7342'), '#D42C49', 12);
  }
  drawInvitationButton('Seguir jugando', W * 0.04, H * 0.84, W * 0.3, H * 0.11,
    closeOrchestraInvitation, '#22A879', 14);
}

function orchestraInfoTextScale() {
  if (orchestraInfoPortraitLayout) return Math.min(1.45, Math.max(1.15, 448 / W));
  return W > 400 ? Math.min(W / 400, 1.7) : 1.15;
}

function drawOrchestraInfoCopy(message, x, y, maxWidth, size, lineHeight, color = '#fff', align = 'center', maxLines = 5) {
  message = t(message);
  ctx.save();
  ctx.font = `800 ${size * U}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.1 * U;
  ctx.strokeStyle = 'rgba(8,10,35,0.92)';
  ctx.fillStyle = color;
  const lines = [];
  let line = '';
  for (const word of message.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((part, index) => {
    const baseline = y + index * lineHeight * orchestraInfoTextScale() * U;
    ctx.strokeText(part, x, baseline);
    ctx.fillText(part, x, baseline);
  });
  ctx.restore();
  return lines.length;
}

function drawOrchestraInfoButton(label, x, y, w, h, fn, accent, fontSize = 9, minHitHeight = 48) {
  const hitW = Math.max(w, 48);
  const hitH = Math.max(h, minHitHeight);
  buttons.push({
    x: Math.max(0, Math.min(W - hitW, x - (hitW - w) / 2)),
    y: Math.max(0, Math.min(H - hitH, y - (hitH - h) / 2)),
    w: hitW,
    h: hitH,
    fn,
  });
  drawNeonPanel(x, y, w, h, accent, 'rgba(49,37,110,0.98)', 'rgba(19,22,66,0.98)');
  drawOrchestraInfoCopy(label, x + w / 2, y + h * 0.57, w * 0.9,
    fontSize * orchestraInfoTextScale(), fontSize * 1.13, '#fff', 'center', 2);
}

function drawOrchestraInfoHeader() {
  const scale = orchestraInfoTextScale();
  if (orchestraInfoPortraitLayout) {
    animatedTitle('¡DEJÁ DE JUGAR SOLO', W / 2, H * 0.042, 12.4 * scale, '#FFD52B', W * 0.94);
    animatedTitle('EN LA PANTALLA Y VENÍ', W / 2, H * 0.078, 12.4 * scale, '#00DFFF', W * 0.94);
    animatedTitle('A TOCAR CON NOSOTROS!', W / 2, H * 0.114, 12.4 * scale, '#FFD52B', W * 0.94);
    text('¡Sumate a los más de 1000 integrantes de nuestra Orquesta Escuela!', W / 2, H * 0.15, 8.3 * scale, '#fff');
    return;
  }
  animatedTitle('¡DEJÁ DE JUGAR SOLO EN LA PANTALLA', W / 2, H * 0.078, 13 * scale, '#FFD52B', W * 0.94);
  animatedTitle('Y VENÍ A TOCAR CON NOSOTROS!', W / 2, H * 0.15, 14 * scale, '#00DFFF', W * 0.9);
  text('¡Sumate a los más de 1000 integrantes de nuestra Orquesta Escuela!', W / 2, H * 0.225, 9.2 * scale, '#fff');
}

function drawOrchestraInfoSebastian() {
  const img = CHARACTERS[0].img;
  const portrait = orchestraInfoPortraitLayout;
  const cx = W * (portrait ? 0.16 : 0.15);
  const by = H * (portrait ? 0.84 : 0.88);
  const h = H * (portrait ? 0.13 : 0.54);
  const bob = Math.sin(time * 2.2) * 2 * U;
  const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1096 / 1488;
  const w = h * aspect;
  const sway = drawFitSway(cx);
  const pivotY = by - h * 0.5 + bob;
  const localX = w * 0.34;
  const localY = -h * 0.27;
  drawFit(img, cx, by, h, bob);
  return {
    x: cx + localX * Math.cos(sway) - localY * Math.sin(sway),
    y: pivotY + localX * Math.sin(sway) + localY * Math.cos(sway),
  };
}

function drawOrchestraInfoMusicians() {
  const portrait = orchestraInfoPortraitLayout;
  const x = portrait ? W * 0.035 : W * 0.30;
  const y = H * (portrait ? 0.30 : 0.53);
  const w = W * (portrait ? 0.93 : 0.68);
  const h = H * (portrait ? 0.405 : 0.31);
  const columns = portrait ? 4 : 7;
  const rows = Math.ceil(ORCHESTRA_INFO_MUSICIANS.length / columns);
  drawNeonPanel(x, y, w, h, '#00DFFF', 'rgba(21,40,94,0.90)', 'rgba(12,18,55,0.94)');
  const cellW = w / columns;
  const cellH = h / rows;
  ORCHESTRA_INFO_MUSICIANS.forEach((musician, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const cx = x + cellW * (col + 0.5);
    const cellY = y + cellH * row;
    const bob = Math.sin(time * 2.1 + index * 0.8) * 1.5 * U;
    const spriteH = cellH * 0.56;
    drawFit(musician.character, cx, cellY + cellH * 0.66, spriteH, bob);
    const labelSize = portrait
      ? 8.5 * Math.min(orchestraInfoTextScale(), 1.45)
      : 6.8 * Math.min(orchestraInfoTextScale(), 1.1);
    text(musician.name, cx, cellY + cellH * 0.97, labelSize, '#fff');
  });
}

function drawOrchestraInfoFooter(leftLabel, leftFn, rightLabel, rightFn) {
  const portrait = orchestraInfoPortraitLayout;
  const y = H * (portrait ? 0.91 : 0.84);
  const h = H * (portrait ? 0.078 : 0.16);
  const minHitHeight = Math.max(48, h);
  drawOrchestraInfoButton(leftLabel, W * 0.04, y, W * 0.42, h,
    leftFn, '#00DFFF', portrait ? 8.7 : 9.2, minHitHeight);
  drawOrchestraInfoButton(rightLabel, W * 0.54, y, W * 0.42, h,
    rightFn, '#FFD52B', portrait ? 8.7 : 9.2, minHitHeight);
}

function drawOrchestraInfoWelcome() {
  if (orchestraInfoPortraitLayout) {
    const introX = W * 0.045;
    const introY = H * 0.172;
    const introW = W * 0.91;
    const introH = H * 0.105;
    drawNeonPanel(introX, introY, introW, introH, '#8B20F5', 'rgba(48,35,112,0.94)', 'rgba(18,25,76,0.94)');
    drawOrchestraInfoCopy('¡La música también se vive fuera del juego! Conocé nuestra Orquesta Escuela de Florencio Varela y descubrí cómo formar parte de una verdadera orquesta.',
      introX + introW / 2, introY + H * 0.035, introW * 0.89, 8.5 * orchestraInfoTextScale(), 9.4, '#fff', 'center', 3);
    text('NUESTRA ORQUESTA, MUCHOS INSTRUMENTOS', W / 2, H * 0.294, 7.2 * orchestraInfoTextScale(), '#FFD52B');
    drawOrchestraInfoMusicians();
    drawOrchestraInfoSebastian();
    drawOrchestraInfoCopy('¡Bienvenidos a nuestra Orquesta Escuela!', W * 0.63, H * 0.80,
      W * 0.62, 10 * orchestraInfoTextScale(), 12, '#fff', 'center', 2);
    drawOrchestraInfoFooter('VOLVER A JUGAR', closeOrchestraInfo, '¡QUIERO SUMARME!', () => { orchestraInfoPage = 'contact'; });
    return;
  }

  const introX = W * 0.32;
  const introY = H * 0.265;
  const introW = W * 0.65;
  const introH = H * 0.18;
  drawNeonPanel(introX, introY, introW, introH, '#8B20F5', 'rgba(48,35,112,0.94)', 'rgba(18,25,76,0.94)');
  drawOrchestraInfoCopy('¡La música también se vive fuera del juego! Conocé nuestra Orquesta Escuela de Florencio Varela y descubrí cómo formar parte de una verdadera orquesta.',
    introX + introW / 2, introY + H * 0.048, introW * 0.9, 7.4 * orchestraInfoTextScale(), 8.7, '#fff', 'center', 4);
  drawOrchestraInfoSebastian();
  drawOrchestraInfoCopy('¡Bienvenidos a nuestra Orquesta Escuela!', W * 0.65, H * 0.49,
    W * 0.60, 8.4 * orchestraInfoTextScale(), 10, '#FFD52B', 'center', 2);
  drawOrchestraInfoMusicians();
  drawOrchestraInfoFooter('VOLVER A JUGAR', closeOrchestraInfo, '¡QUIERO SUMARME!', () => { orchestraInfoPage = 'contact'; });
}

function drawOrchestraInfoContact() {
  const scale = orchestraInfoTextScale();
  if (orchestraInfoPortraitLayout) {
    drawOrchestraInfoCopy('Si sos menor de edad, pedile ayuda a una persona adulta responsable para comunicarte con nuestra escuela.',
      W / 2, H * 0.198, W * 0.93, 7.4 * scale, 8.4, '#FFD52B', 'center', 2);

    const leftX = W * 0.05;
    const cardW = W * 0.90;
    drawNeonPanel(leftX, H * 0.235, cardW, H * 0.222, '#FFD52B', 'rgba(54,40,112,0.96)', 'rgba(19,25,72,0.97)');
    text('📍 ESCUELA N.º 501', W / 2, H * 0.268, 10.2 * scale, '#FFD52B');
    drawOrchestraInfoCopy('Chacabuco 68 — Florencio Varela', W / 2, H * 0.304,
      cardW * 0.9, 8.8 * scale, 10, '#fff', 'center', 2);
    text('Provincia de Buenos Aires', W / 2, H * 0.34, 8 * scale, '#dce6ff');
    drawOrchestraInfoButton('📍 CÓMO LLEGAR', W * 0.13, H * 0.37, W * 0.74, H * 0.064,
      () => requestOrchestraLink('https://www.google.com/maps/search/?api=1&query=Chacabuco+68+Florencio+Varela+Buenos+Aires'), '#22A879', 9.1, 48);

    drawNeonPanel(leftX, H * 0.472, cardW, H * 0.342, '#FF28CC', 'rgba(59,26,112,0.96)', 'rgba(20,24,72,0.97)');
    text('¿QUERÉS SER PARTE?', W / 2, H * 0.505, 10.2 * scale, '#FF9BEA');
    drawOrchestraInfoCopy('Comunicate con nosotros a través de nuestras redes sociales para consultar cómo inscribirte y comenzar tu aventura musical.',
      W / 2, H * 0.537, W * 0.82, 7.3 * scale, 8.2, '#fff', 'center', 3);
    drawOrchestraInfoCopy('YouTube permite conocer la actividad de la orquesta. Consultas de inscripción: Instagram o Facebook.',
      W / 2, H * 0.607, W * 0.84, 6.8 * scale, 7.6, '#e3e7ff', 'center', 2);
    const socialY = H * 0.69;
    const socialW = W * 0.285;
    drawOrchestraInfoButton('📸 INSTAGRAM', W * 0.055, socialY, socialW, H * 0.075,
      () => requestOrchestraLink('https://www.instagram.com/orquestaescuelaflorenciovarela/'), '#8B20F5', 7.3, 48);
    drawOrchestraInfoButton('📘 FACEBOOK', W * 0.3575, socialY, socialW, H * 0.075,
      () => requestOrchestraLink('https://www.facebook.com/search/top?q=orquesta%20escuela%20de%20florencio%20varela%20noticias%20y%20prensa'), '#1269F3', 7.3, 48);
    drawOrchestraInfoButton('▶ YOUTUBE', W * 0.66, socialY, socialW, H * 0.075,
      () => requestOrchestraLink('https://www.youtube.com/@orquestaescuelafciovarel7342'), '#D42C49', 7.3, 48);
    drawOrchestraInfoFooter('VOLVER A JUGAR', closeOrchestraInfo, '← CONOCÉ LA ORQUESTA', () => { orchestraInfoPage = 'welcome'; });
    return;
  }

  const panelY = H * 0.35;
  const panelH = H * 0.48;
  const leftX = W * 0.04;
  const cardW = W * 0.44;
  const rightX = W * 0.52;
  drawOrchestraInfoCopy('Si sos menor de edad, pedile ayuda a una persona adulta responsable para comunicarte con nuestra escuela.',
    W / 2, H * 0.29, W * 0.92, 6.1 * scale, 7, '#FFD52B', 'center', 1);
  drawNeonPanel(leftX, panelY, cardW, panelH, '#FFD52B', 'rgba(54,40,112,0.96)', 'rgba(19,25,72,0.97)');
  drawNeonPanel(rightX, panelY, cardW, panelH, '#FF28CC', 'rgba(59,26,112,0.96)', 'rgba(20,24,72,0.97)');

  text('📍 ESCUELA N.º 501', leftX + cardW / 2, H * 0.43, 9.6 * scale, '#FFD52B');
  drawOrchestraInfoCopy('Chacabuco 68 — Florencio Varela', leftX + cardW / 2, H * 0.51,
    cardW * 0.9, 8.4 * scale, 10, '#fff', 'center', 2);
  text('Provincia de Buenos Aires', leftX + cardW / 2, H * 0.57, 7.6 * scale, '#dce6ff');
  drawOrchestraInfoButton('📍 CÓMO LLEGAR', leftX + cardW * 0.08, H * 0.62, cardW * 0.84, H * 0.11,
    () => requestOrchestraLink('https://www.google.com/maps/search/?api=1&query=Chacabuco+68+Florencio+Varela+Buenos+Aires'), '#22A879', 9.4);

  text('¿QUERÉS SER PARTE?', rightX + cardW / 2, H * 0.43, 9.6 * scale, '#FF9BEA');
  drawOrchestraInfoCopy('Comunicate con nosotros a través de nuestras redes sociales para consultar cómo inscribirte y comenzar tu aventura musical.',
    rightX + cardW / 2, H * 0.46, cardW * 0.9, 6.1 * scale, 7, '#fff', 'center', 4);
  drawOrchestraInfoCopy('YouTube permite conocer la actividad de la orquesta. Consultas de inscripción: Instagram o Facebook.',
    rightX + cardW / 2, H * 0.585, cardW * 0.96, 5.2 * scale, 5.8, '#e3e7ff', 'center', 2);
  const socialY = H * 0.69;
  const socialW = W * 0.15;
  const socialStart = W * 0.505;
  drawOrchestraInfoButton('📸 INSTAGRAM', socialStart, socialY, socialW, H * 0.115,
    () => requestOrchestraLink('https://www.instagram.com/orquestaescuelaflorenciovarela/'), '#8B20F5', 7.5, 40);
  drawOrchestraInfoButton('📘 FACEBOOK', socialStart + W * 0.15, socialY, socialW, H * 0.115,
    () => requestOrchestraLink('https://www.facebook.com/search/top?q=orquesta%20escuela%20de%20florencio%20varela%20noticias%20y%20prensa'), '#1269F3', 7.5, 40);
  drawOrchestraInfoButton('▶ YOUTUBE', socialStart + W * 0.30, socialY, socialW, H * 0.115,
    () => requestOrchestraLink('https://www.youtube.com/@orquestaescuelafciovarel7342'), '#D42C49', 7.5, 40);
  drawOrchestraInfoFooter('VOLVER A JUGAR', closeOrchestraInfo, '← CONOCÉ LA ORQUESTA', () => { orchestraInfoPage = 'welcome'; });
}

function drawOrchestraInfoScreen() {
  drawInvitationBackdrop();
  drawOrchestraInfoHeader();
  if (invitationPendingUrl) {
    drawOrchestraExternalWarning();
    return;
  }
  if (orchestraInfoPage === 'contact') drawOrchestraInfoContact();
  else drawOrchestraInfoWelcome();
}

function drawSalieriAllyDialog() {
  ctx.fillStyle = 'rgba(8,10,27,0.82)';
  ctx.fillRect(0, 0, W, H);
  const x = W * 0.08;
  const y = H * 0.13;
  const w = W * 0.84;
  const h = H * 0.74;
  panel(x, y, w, h, 0.98);
  const page = salieriRunner.allyDialogPage;
  const headings = ['¡BRAVO, GRAN MÚSICO!', '¡SALIERI ES TU ALIADO!', 'UN DATO MUSICAL'];
  title(headings[page] || headings[2], W / 2, y + H * 0.105, 15, '#ffe45d');
  const sprite = ESCAPE_SALIERI_FRIENDLY;
  if (sprite?.complete && sprite.naturalWidth) {
    const maxH = h * 0.69;
    const ratio = sprite.naturalWidth / sprite.naturalHeight;
    const spriteH = maxH;
    const spriteW = spriteH * ratio;
    const fit = Math.min(w * 0.33 / spriteW, (h * 0.78) / spriteH);
    ctx.drawImage(sprite, x + w * 0.02, y + h * 0.17, spriteW * fit, spriteH * fit);
  }
  const copyX = x + w * 0.36;
  const copyW = w * 0.59;
  const message = page === 0
    ? '¡BRAVO! ¡DEMOSTRASTE SER UN GRAN MÚSICO!'
    : page === 1
      ? '¡DESDE AHORA SOMOS AMIGOS! ¡CORRAMOS AL MISMO RITMO!'
      : 'El verdadero Antonio Salieri fue un reconocido compositor y profesor de música. Su rivalidad con Mozart fue exagerada por la ficción.';
  wrappedText(message, copyX + copyW / 2, y + h * 0.43, copyW, page === 2 ? 14 : 18, page === 2 ? 10 : 12, page === 2 ? '#d8d8ee' : '#fff');
  button(page < 2 ? 'CONTINUAR  ▶' : 'SEGUIR JUGANDO', W * 0.34, y + h * 0.82, W * 0.32, 34 * U,
    () => salieriRunner.closeAllyDialog(), '#22bd83', 10.5);
}

function drawSalieriEscape() {
  syncRunnerAvatar();
  salieriRunner.draw(ctx, W, H, U, time);
  panel(6 * U, 6 * U, W - 12 * U, 36 * U, 0.8);
  avatarBadge(profile.avatar, 25 * U, 24 * U, 28 * U);
  ctx.save();
  ctx.beginPath(); ctx.rect(46 * U, 5 * U, 70 * U, 34 * U); ctx.clip();
  text(playerName, 47 * U, 22 * U, 9.5, '#fff', 'left');
  ctx.restore();
  text(`PTS ${Math.floor(salieriRunner.score)}`, W * 0.36, 25 * U, 8.5, '#ffe45d');
  text(`♪ ${salieriRunner.notes}`, W * 0.49, 25 * U, 8.5, '#fff');
  text(`RÉC ${Number(storageGet(ESCAPE_BEST_KEY) || 0)}`, W * 0.64, 25 * U, 8, '#bdeeff');
  panel(W - 111 * U, 45 * U, 105 * U, 21 * U, 0.9);
  for (let i = 0; i < 5; i++) {
    text('♪', (W - 102 * U) + i * 19 * U, 60 * U, 15, i < salieriRunner.lives ? '#ffe45d' : '#615a72');
  }
  text(salieriRunner.lives >= 5 ? 'VIDAS AL MÁXIMO' : `Próxima vida: ${salieriRunner.nextLifeScore} puntos`,
    13 * U, H - 7 * U, 7.5, '#fff0b2', 'left');
  if (salieriRunner.shieldCharges > 0) text('ESCUDO MUSICAL', W * 0.82, H * 0.34, 7.5, '#7deaff');
  button(muted ? '🔇' : '🔊', W - 99 * U, 8 * U, 35 * U, 30 * U, toggleMute, '#4356a3', 12);
  button(salieriRunner.paused ? '▶' : 'Ⅱ', W - 54 * U, 8 * U, 38 * U, 30 * U,
    () => salieriRunner.togglePause(), '#e85c5c', 13);

  if (salieriRunner.allyDialogOpen) {
    buttons = [];
    drawSalieriAllyDialog();
    return;
  }

  if (!salieriRunner.finished && !salieriRunner.paused) {
    buttons.push({ x: W * 0.72, y: H * 0.32, w: W * 0.28, h: H * 0.62, fn: () => salieriRunner.jump() });
    ctx.save();
    ctx.globalAlpha = 0.42;
    text(isCoarsePointerDevice() ? 'TOCÁ PARA SALTAR' : 'ESPACIO / ↑', W * 0.84, H * 0.93, 8.5, '#fff');
    ctx.restore();
  }

  if (salieriRunner.paused && !salieriRunner.finished) {
    ctx.fillStyle = 'rgba(8,10,27,0.72)'; ctx.fillRect(0, 0, W, H);
    panel(W * 0.2, H * 0.25, W * 0.6, H * 0.5, 0.95);
    title('PAUSA MUSICAL', W / 2, H * 0.4, 22, '#ffe45d');
    button('▶ CONTINUAR', W * 0.28, H * 0.49, W * 0.44, 42 * U,
      () => salieriRunner.togglePause(), '#22bd83', 13);
    button('← MENÚ', W * 0.34, H * 0.66, W * 0.32, 38 * U, returnToMenu, '#4356a3', 12);
    return;
  }

  if (salieriRunner.finished) {
    ctx.fillStyle = 'rgba(8,10,27,0.78)'; ctx.fillRect(0, 0, W, H);
    panel(W * 0.09, H * 0.11, W * 0.82, H * 0.78, 0.96);
    title('¡FIN DEL CONCIERTO!', W / 2, H * 0.245, 21, '#ffe45d');
    text(`${Math.floor(salieriRunner.score)} puntos   ·   Récord ${Number(storageGet(ESCAPE_BEST_KEY) || 0)}`,
      W / 2, H * 0.385, 13, '#fff');
    text(`Distancia ${Math.floor(salieriRunner.distance)} m   ·   Notas ${salieriRunner.notes}   ·   Obstáculos ${salieriRunner.dodges}`,
      W / 2, H * 0.49, 11.5, '#bdeeff');
    const earned = salieriNewAchievements.map((id) => ESCAPE_ACHIEVEMENT_LABELS[id]).filter(Boolean);
    const rewardText = earned.length ? `Logros: ${earned.slice(0, 2).join(' · ')}` : '¡Cada intento te acerca a un nuevo logro!';
    wrappedText(rewardText, W / 2, H * 0.61, W * 0.76, 17, 10.5, '#ffe45d');
    const buttonY = H * 0.735;
    const buttonW = W * 0.255;
    button('↻ REINTENTAR', W * 0.065, buttonY, buttonW, 38 * U, startSalieriEscape, '#22bd83', 10);
    button('🏆 CLASIFICACIÓN', W * 0.372, buttonY, buttonW, 38 * U, () => { scene = 'salieri-ranking'; }, '#8b4de8', 9.2);
    button('⌂ MENÚ', W * 0.679, buttonY, buttonW, 38 * U, returnToMenu, '#4356a3', 10);
  }
}

function drawSalieriRanking() {
  salieriRunner.drawBackground(ctx, W, H, time);
  ctx.fillStyle = 'rgba(10,12,35,0.76)'; ctx.fillRect(0, 0, W, H);
  title('CLASIFICACIÓN · ESCAPE', W / 2, H * 0.12, 21, '#ffe45d');
  let localRows = [];
  try {
    const saved = JSON.parse(storageGet(ESCAPE_LOCAL_SCORES_KEY) || '[]');
    localRows = Array.isArray(saved) ? saved : [];
  } catch (error) { localRows = []; }
  const onlineRows = ranking.filter((row) => row.game === 'escape-salieri' && !containsProfanity(row.name));
  text(onlineRows.length ? 'Partidas locales y resultados globales disponibles' : 'Mejores partidas guardadas en este dispositivo', W / 2, H * 0.18, 10.5, '#dce7ff');
  const rows = [...localRows];
  onlineRows.forEach((onlineRow) => {
    const duplicate = localRows.some((localRow) => localRow.name === onlineRow.name
      && Number(localRow.score) === Number(onlineRow.score)
      && Math.abs(Number(localRow.timestamp || 0) - Number(onlineRow.timestamp || 0)) < 5000);
    if (!duplicate) rows.push(onlineRow);
  });
  rows.sort((a, b) => b.score - a.score);
  rows.slice(0, 7).forEach((row, index) => {
    const y = H * (0.24 + index * 0.065);
    panel(W * 0.09, y, W * 0.82, H * 0.055, index === 0 ? 0.9 : 0.68);
    text(`${index + 1}.`, W * 0.15, y + H * 0.037, 10, '#ffe45d');
    avatarBadge(row.avatar, W * 0.23, y + H * 0.027, H * 0.043);
    text(containsProfanity(row.name) ? 'Músico' : String(row.name || 'Músico').slice(0, 18),
      W * 0.31, y + H * 0.037, 9.5, '#fff', 'left');
    text(String(row.score || 0), W * 0.86, y + H * 0.037, 10, '#bdeeff', 'right');
  });
  if (!rows.length) text('Jugá tu primera carrera para estrenar la tabla.', W / 2, H * 0.45, 11, '#fff');
  text(onlineRows.length ? 'Se muestran también resultados online recibidos.' : 'Guardado local · ranking entre dispositivos requiere un servicio online configurado.', W / 2, H * 0.77, 8, '#c9c5e8');
  button('← VOLVER', W * 0.34, H * 0.85, W * 0.32, 32 * U, () => { scene = 'salieri-runner'; }, '#4356a3', 10);
}

function drawRunnerPortraitPrompt() {
  ctx.fillStyle = '#101127'; ctx.fillRect(0, 0, W, H);
  panel(W * 0.12, H * 0.12, W * 0.76, H * 0.76, 0.95);
  const cx = W / 2;
  const cy = H * 0.42;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#26356e';
  ctx.strokeStyle = '#31dcff';
  ctx.lineWidth = 3 * U;
  ctx.beginPath(); ctx.roundRect(-H * 0.2, -W * 0.12, H * 0.4, W * 0.24, 16 * U); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#11132b';
  ctx.beginPath(); ctx.roundRect(-H * 0.175, -W * 0.095, H * 0.35, W * 0.19, 11 * U); ctx.fill();
  ctx.restore();
  title('¡GIRÁ TU DISPOSITIVO!', cx, H * 0.72, 18, '#ffe45d');
  text('Este desafío se juega en horizontal', cx, H * 0.8, 10, '#fff');
  button('← MENÚ', W * 0.35, H * 0.84, W * 0.3, 34 * U, returnToMenu, '#4356a3', 10);
}

function drawPortraitPrompt() {
  ctx.fillStyle = '#11132B';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;
  const phoneW = Math.min(W * 0.22, H * 0.52);
  const phoneH = Math.min(H * 0.58, W * 0.48);
  const phoneX = cx - phoneW / 2;
  const phoneY = cy - phoneH / 2 - H * 0.06;
  ctx.save();
  ctx.shadowColor = '#00DFFF';
  ctx.shadowBlur = 18 * U;
  ctx.fillStyle = 'rgba(32,42,91,0.96)';
  ctx.beginPath(); ctx.roundRect(phoneX, phoneY, phoneW, phoneH, 20 * U); ctx.fill();
  ctx.strokeStyle = '#00DFFF'; ctx.lineWidth = 3 * U; ctx.stroke();
  ctx.fillStyle = '#11132B';
  ctx.beginPath(); ctx.roundRect(phoneX + 7 * U, phoneY + 12 * U, phoneW - 14 * U, phoneH - 24 * U, 14 * U); ctx.fill();
  ctx.fillStyle = '#FFD52B';
  ctx.beginPath(); ctx.arc(cx, phoneY + phoneH * 0.83, 3.5 * U, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  title('GIRÁ TU TELÉFONO', cx, cy + phoneH * 0.68, 24, '#fff');
  text('Este juego se disfruta en formato vertical', cx, H * 0.94, 26, '#4df0ff');
}

function drawCountdown() {
  drawCover(STAGES[selectedStage].img);
  ctx.fillStyle = 'rgba(8,12,24,0.78)';
  ctx.fillRect(0, 0, W, H);
  drawMovingLights();
  panel(W * 0.08, H * 0.07, W * 0.84, H * 0.12, 0.82);
  wrappedText(countdownState?.message || 'Sebastián te espera', W / 2, H * 0.12, W * 0.74, 20, 15, '#fff');
  drawFit(CHARACTERS[0].img, W / 2, H * 0.49, H * 0.32, Math.sin(time * 5) * 4);
  const pulse = 1 + Math.sin(time * 8) * 0.08;
  ctx.save(); ctx.translate(W / 2, H * 0.73); ctx.scale(pulse, pulse);
  ctx.fillStyle = '#ff3d7f';
  ctx.beginPath(); ctx.arc(0, 0, 58 * U, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 5 * U; ctx.stroke();
  title(String(countdownState?.value || 1), 0, 17 * U, 54, '#fff');
  ctx.restore();
  text('Preparados…', W / 2, H * 0.85, 14, '#ffe14d');
}

function render() {
  if (runnerLayout && isMobilePortrait()) {
    buttons = [];
    drawRunnerPortraitPrompt();
    return;
  }
  if (isMobileLandscape() && !runnerLayout && scene !== 'intro' && scene !== 'orchestra-invite' && scene !== 'orchestra-info' && scene !== 'credits') {
    buttons = [];
    drawPortraitPrompt();
    return;
  }
  if (keyboardFocusScene !== scene) {
    keyboardFocusScene = scene;
    keyboardFocusIndex = -1;
  }
  buttons = [];
  if (scene === 'countdown') drawCountdown();
  else if (scene === 'intro') drawWelcome();
  else if (scene === 'orchestra-invite') drawOrchestraInvitation();
  else if (scene === 'orchestra-info') drawOrchestraInfoScreen();
  else if (scene === 'credits') drawCredits();
  else if (scene === 'menu') drawMenu();
  else if (scene === 'meter-select') drawMeterSelect();
  else if (scene === 'difficulty-select') drawDifficultySelect();
  else if (scene === 'quiz-setup') drawQuizSetup();
  else if (scene === 'quiz-room') drawQuizRoom();
  else if (scene === 'duel-lobby') drawDuelLobby();
  else if (scene === 'play') drawPlay();
  else if (scene === 'salieri-runner') drawSalieriEscape();
  else if (scene === 'salieri-ranking') drawSalieriRanking();
  else if (scene === 'profile') drawProfile();
  else if (scene === 'premios') drawAwards();
  else if (scene === 'ranking') drawRanking();
  else if (scene === 'clase') drawClassMenu();
  else if (scene === 'instrument-guide') drawInstrumentGuide();
  else if (scene === 'clase-play') drawLesson();
  else if (scene === 'missions') drawMissions();
  else if (scene === 'settings') drawSettings();
  else drawResult();
  if (document.activeElement === canvas && keyboardFocusIndex >= 0) {
    if (keyboardFocusIndex >= buttons.length) keyboardFocusIndex = buttons.length - 1;
    const focused = buttons[keyboardFocusIndex];
    if (focused) {
      ctx.save();
      ctx.shadowColor = '#FFD52B';
      ctx.shadowBlur = 9 * U;
      ctx.strokeStyle = '#FFD52B';
      ctx.lineWidth = 2.5 * U;
      ctx.beginPath();
      ctx.roundRect(focused.x - 2 * U, focused.y - 2 * U, focused.w + 4 * U, focused.h + 4 * U, 10 * U);
      ctx.stroke();
      ctx.restore();
    }
  }
  particles.forEach((p) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    if (p.star) drawStarShape(p.x, p.y, p.size || 6 * U, p.c);
    else {
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
  });
  ctx.globalAlpha = 1;
  popups.forEach((p) => {
    ctx.globalAlpha = Math.max(0, p.life);
    text(p.text, p.x, p.y, 20, p.color);
  });
  ctx.globalAlpha = 1;
}

// ---------- Pausa inteligente (segundo plano) ----------
let appSuspended = false;
let resumeGateOpen = false;        // Pide "CONTINUAR" antes de reanudar un minijuego activo.
let suspendedAudio = [];           // Pistas que sonaban al ocultarse (solo esas se reanudan).
let appLifecycleListenersReady = false;

function isTimedGameplayScene() {
  return scene === 'play' || scene === 'clase-play' || scene === 'countdown';
}

function suspendApp(reason) {
  if (appSuspended) return;
  appSuspended = true;
  // Liberar controles que hayan quedado presionados.
  pointer.down = false;
  menuPointerDown = null;
  profilePointerDown = null;
  keyboardConductorHeld = false;
  // Escape de Salieri: usar su pausa propia (detiene zorro, obstáculos y encuentros).
  if (scene === 'salieri-runner' && !salieriRunner.finished && !salieriRunner.paused && !salieriRunner.allyDialogOpen) {
    salieriRunner.togglePause();
    handleSalieriRunnerEvents();
  }
  // Recordar solo lo que realmente sonaba; la música del Escape vuelve con su "CONTINUAR".
  suspendedAudio = [music, welcomeMusic, escapeMusic]
    .filter((track) => !track.paused && !(track === escapeMusic && scene === 'salieri-runner' && salieriRunner.paused));
  [music, welcomeMusic, escapeMusic, sfxClap, escapeJumpSound, escapeSalieriSound].forEach((track) => {
    try { track.pause(); } catch (error) { /* sin acción */ }
  });
  if (actx && actx.state === 'running') actx.suspend().catch(() => {});
  if (isTimedGameplayScene()) resumeGateOpen = true;
  if (reason !== 'freeze') saveProgressLocally();
}

function resumeSuspendedAudio() {
  if (appSuspended || resumeGateOpen || muted || !suspendedAudio.length) {
    if (muted) suspendedAudio = [];
    return;
  }
  const tracks = suspendedAudio;
  suspendedAudio = [];
  tracks.forEach((track) => {
    if (!track.paused) return; // Ya suena: no duplicar.
    track.play().catch(() => {
      // Android puede exigir un toque: se reintenta en la próxima interacción.
      if (!suspendedAudio.includes(track)) suspendedAudio.push(track);
    });
  });
}

function resumeApp() {
  if (!appSuspended) return;
  appSuspended = false;
  last = performance.now(); // No acumular el tiempo que la app estuvo oculta.
  pointer.down = false;
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  resumeSuspendedAudio();
}

function closeResumeGate() {
  if (!resumeGateOpen) return;
  resumeGateOpen = false;
  last = performance.now();
  pointer.down = false;
  resumeSuspendedAudio();
}

function drawResumeGate() {
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,27,0.72)';
  ctx.fillRect(0, 0, W, H);
  const bw = Math.min(W * 0.7, 300 * U);
  const bh = Math.max(48, 54 * U);
  text('JUEGO EN PAUSA', W / 2, H * 0.42, 20, '#FFD52B');
  ctx.fillStyle = '#22a879';
  ctx.beginPath(); ctx.roundRect(W / 2 - bw / 2, H * 0.48, bw, bh, 14 * U); ctx.fill();
  text('▶ CONTINUAR', W / 2, H * 0.48 + bh * 0.64, 16, '#fff');
  ctx.restore();
}

function setupAppLifecycle() {
  if (appLifecycleListenersReady) return; // Evita listeners duplicados.
  appLifecycleListenersReady = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspendApp('hidden');
    else resumeApp();
  });
  window.addEventListener('pagehide', () => suspendApp('pagehide'));
  window.addEventListener('pageshow', (event) => { if (event.persisted || !document.hidden) resumeApp(); });
  document.addEventListener('freeze', () => suspendApp('freeze'));
  document.addEventListener('resume', () => { if (!document.hidden) resumeApp(); });
  // Cualquier toque o tecla con la puerta de pausa abierta solo reanuda (no actúa sobre el juego).
  canvas.addEventListener('pointerdown', (event) => {
    if (resumeGateOpen) {
      event.stopImmediatePropagation();
      pointer.down = false;
      closeResumeGate();
    } else if (suspendedAudio.length) {
      resumeSuspendedAudio();
    }
  }, true);
  window.addEventListener('keydown', (event) => {
    if (!resumeGateOpen) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    closeResumeGate();
  }, true);
}
setupAppLifecycle();

// ---------- Bucle principal protegido ----------
let last = performance.now();
let loopFrameId = 0;
let consecutiveFrameErrors = 0;
let loopRecoveryAttempted = false;
let loopHalted = false;
const loggedLoopErrors = new Set();
const LOOP_ERROR_RECOVERY_THRESHOLD = 20;

function logLoopError(phase, error) {
  const signature = `${phase}|${scene}|${error?.message || error}`;
  if (loggedLoopErrors.has(signature)) return; // Evita repetir el mismo mensaje en cada cuadro.
  loggedLoopErrors.add(signature);
  console.error(`[bucle] Error en ${phase} (escena "${scene}"):`, error);
}

let loopErrorOverlay = null;
function showLoopErrorOverlay(error) {
  if (!loopErrorOverlay) {
    loopErrorOverlay = document.createElement('div');
    loopErrorOverlay.setAttribute('role', 'alertdialog');
    loopErrorOverlay.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;background:rgba(9,11,25,.94);color:#fff;font:700 15px Nunito,sans-serif;text-align:center;';
    const title = document.createElement('div');
    title.textContent = '🎻 Algo desafinó en la orquesta';
    title.style.cssText = 'font-size:20px;color:#FFD52B;';
    const detail = document.createElement('div');
    detail.dataset.role = 'detail';
    detail.style.cssText = 'max-width:520px;font-size:12px;color:#cfd6ff;';
    const makeButton = (label, color, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = `min-width:220px;min-height:48px;border:0;border-radius:14px;background:${color};color:#fff;font:800 15px Nunito,sans-serif;`;
      b.addEventListener('click', onClick);
      return b;
    };
    loopErrorOverlay.append(
      title,
      detail,
      makeButton('⌂ Volver al menú', '#8b20f5', () => {
        loopErrorOverlay.style.display = 'none';
        consecutiveFrameErrors = 0;
        loopRecoveryAttempted = false;
        loopHalted = false;
        try { returnToMenu(); } catch (menuError) { console.error('[bucle] No se pudo volver al menú.', menuError); }
      }),
      makeButton('↻ Reiniciar el juego', '#22a879', () => { saveProgressLocally(); location.reload(); }),
    );
    document.body.appendChild(loopErrorOverlay);
  }
  loopErrorOverlay.querySelector('[data-role="detail"]').textContent =
    `Tu progreso está guardado. Detalle técnico: ${error?.message || error}`;
  loopErrorOverlay.style.display = 'flex';
}

function handleFrameError(phase, error) {
  logLoopError(phase, error);
  // Un error a mitad del dibujo puede dejar el contexto con save() sin restore(): se reinicia.
  try { resize(); } catch (resizeError) { /* sin acción */ }
  pointer.down = false;
  consecutiveFrameErrors += 1;
  if (consecutiveFrameErrors >= LOOP_ERROR_RECOVERY_THRESHOLD) {
    if (!loopRecoveryAttempted) {
      // Primer intento de recuperación automática: volver al menú.
      loopRecoveryAttempted = true;
      consecutiveFrameErrors = 0;
      console.warn('[bucle] Error persistente; intentando volver al menú.');
      try { returnToMenu(); } catch (menuError) { logLoopError('recuperación', menuError); }
    } else {
      // Falla también tras recuperar: detener el juego y mostrar la pantalla de error.
      loopHalted = true;
      console.error('[bucle] El error persiste tras la recuperación; se muestra la pantalla de error.');
      showLoopErrorOverlay(error);
    }
  }
}

function loop(now) {
  // Se agenda primero el próximo cuadro para que una excepción nunca detenga el bucle.
  loopFrameId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (loopHalted || appSuspended) return;
  let frameOk = true;
  // Con la puerta de pausa abierta la simulación queda congelada (sin tiempo, vidas ni obstáculos).
  if (!resumeGateOpen) {
    try { update(dt); } catch (error) { frameOk = false; handleFrameError('update', error); }
  }
  if (loopHalted) return;
  try {
    render();
    if (resumeGateOpen) drawResumeGate();
  } catch (error) { frameOk = false; handleFrameError('render', error); }
  if (frameOk) {
    consecutiveFrameErrors = 0;
    if (scene === 'menu') loopRecoveryAttempted = false;
  }
}
// Errores fuera del bucle (controles táctiles, promesas): se registran una vez, sin ocultarlos.
const loggedGlobalErrors = new Set();
window.addEventListener('error', (event) => {
  const signature = `${event.message}|${event.filename}|${event.lineno}`;
  if (loggedGlobalErrors.has(signature)) return;
  loggedGlobalErrors.add(signature);
  console.error(`[global] Error no controlado (escena "${scene}"):`, event.error || event.message);
  pointer.down = false;
});
window.addEventListener('unhandledrejection', (event) => {
  const signature = `promesa|${event.reason?.message || event.reason}`;
  if (loggedGlobalErrors.has(signature)) return;
  loggedGlobalErrors.add(signature);
  console.warn('[global] Promesa rechazada sin control:', event.reason);
});

// Un único bucle de animación.
if (!loopFrameId) loopFrameId = requestAnimationFrame(loop);
// Señal para el control de arranque de index.html.
window.__oefvBooted = true;
// Las actualizaciones (pwa.js) solo se aplican en pantallas sin partida en curso.
const UPDATE_SAFE_SCENES = new Set(['menu', 'profile', 'ranking', 'premios', 'settings', 'missions', 'clase', 'instrument-guide']);
window.__oefvCanUpdate = () => UPDATE_SAFE_SCENES.has(scene) && !resumeGateOpen && !appSuspended;
