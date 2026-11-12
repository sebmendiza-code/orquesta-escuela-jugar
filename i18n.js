// Sistema centralizado de idiomas (español / inglés).
// Las claves son los textos originales en español: si falta una traducción se muestra el español (respaldo).
// La preferencia se guarda en localStorage con una clave propia (no forma parte del perfil ni del progreso).

const LANG_KEY = 'orquesta-lang';
const listeners = new Set();

function detectLanguage() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch (e) { /* almacenamiento bloqueado */ }
  const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'es']);
  return String(langs[0] || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
}

let lang = detectLanguage();
export function getLang() { return lang; }
export function setLang(next) {
  if (next !== 'es' && next !== 'en') return;
  lang = next;
  cache.clear();
  try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* sin persistencia */ }
  applyDocumentLanguage();
  listeners.forEach((fn) => { try { fn(lang); } catch (e) { /* ignorar */ } });
}
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const GAME_TITLE = { es: 'Orquesta Escuela: Una Aventura Musical', en: 'Orchestra School: A Musical Adventure' };
export const SLOGAN_EN = 'Play. Learn. Make Music.';

function applyDocumentLanguage() {
  try {
    document.documentElement.lang = lang;
    document.title = GAME_TITLE[lang];
  } catch (e) { /* sin DOM */ }
}
applyDocumentLanguage();

// ---------------- Diccionario español → inglés ----------------
const EN = {
  // Menú principal
  'ELEGÍ TU AVENTURA': 'CHOOSE YOUR ADVENTURE',
  '🎻 ¡SUMATE A NUESTRA ORQUESTA REAL!': '🎻 JOIN OUR REAL ORCHESTRA!',
  '¡De la pantalla al escenario!': 'From the screen to the stage!',
  '¡ESCAPE DE SALIERI!': 'ESCAPE FROM SALIERI!',
  'CORRÉ, SALTÁ Y ESQUIVÁ SUS TRAVESURAS': 'RUN, JUMP AND DODGE HIS TRICKS',
  'DIRIGIR': 'CONDUCT', 'SEGUIR EL': 'FOLLOW THE', 'RITMO': 'RHYTHM', 'DESAFÍO': 'SYMPHONIC', 'SINFÓNICO': 'CHALLENGE',
  'ROSCO': 'MUSICAL', 'MUSICAL': 'WHEEL',
  'Sé el director': 'Be the conductor', 'de la orquesta': 'of the orchestra',
  'Sentí la música': 'Feel the music', 'y seguí el compás': 'and keep the beat',
  'Poné a prueba tu': 'Put your musical', 'oído musical': 'ear to the test',
  'Respondé, completá': 'Answer, complete', 'y ganá puntos': 'and earn points',
  'DESAFÍO DEL DÍA': 'DAILY CHALLENGE',
  'Una ronda de Seguir el Ritmo': 'One round of Follow the Rhythm',
  'Puntaje real · sin bonus diario': 'Real score · no daily bonus',
  'JUGAR AHORA': 'PLAY NOW', '🎵 JUGAR AHORA': '🎵 PLAY NOW',
  '🎵 HERRAMIENTAS MUSICALES': '🎵 MUSIC TOOLS', '🎻 AFINADOR': '🎻 TUNER', '🥁 METRÓNOMO': '🥁 METRONOME',
  '🤝 COMUNIDAD': '🤝 COMMUNITY', '🎼 Orquesta': '🎼 Orchestra', '📚 Clase': '📚 Class', '🎯 Misiones': '🎯 Missions',
  '🤝 Sponsors': '🤝 Sponsors', '⚙ Ajustes': '⚙ Settings',
  'Inicio': 'Home', 'Juegos': 'Games', 'Perfil': 'Profile', 'Ranking': 'Leaderboard', 'Premios': 'Awards',
  'RACHA · no registrada': 'STREAK · not tracked', '¡Nivel máximo!': 'Max level!',
  'NIVEL': 'LEVEL',
  // Conexión
  '⚪ OFFLINE': '⚪ OFFLINE', '🟡 SINCRONIZANDO': '🟡 SYNCING', '🟢 ONLINE': '🟢 ONLINE', '🔴 ERROR': '🔴 ERROR',
  '¡Podés seguir jugando sin Internet!': 'You can keep playing offline!',
  '¡Conexión recuperada! Sincronizando tus avances.': 'Back online! Syncing your progress.',
  '¡Tus puntajes ya están actualizados!': 'Your scores are up to date!',
  '¡Tus puntajes se guardaron en este dispositivo!': 'Your scores were saved on this device!',
  'La conexión online no está disponible. Revisá la configuración de InstantDB.': 'Online connection is not available. Check the InstantDB configuration.',
  'No se pudo abrir la sala. Probá con otro código.': 'Could not open the room. Try another code.',
  '¿Borrar el perfil y todo el progreso guardado en este dispositivo? Esto no elimina puntajes que ya estén en el ranking online.': 'Delete the profile and all progress saved on this device? This does not remove scores already on the online leaderboard.',
  'No se pudo borrar el perfil local. Revisá los permisos de almacenamiento del navegador.': 'Could not delete the local profile. Check the browser storage permissions.',
  '💾 Guardado en este dispositivo · nube de progreso no configurada': '💾 Saved on this device · progress cloud not configured',
  '⚠ No se pudo guardar en este dispositivo': '⚠ Could not save on this device',
  // Modales DOM
  'Elegí un apodo público': 'Choose a public nickname',
  'Apodo (no uses tu nombre real)': 'Nickname (don’t use your real name)',
  'Apodo público de perfil': 'Public profile nickname',
  '🎵 ¡Elegí otro nombre! En nuestra orquesta nos respetamos y cuidamos entre todos. Probá con un apodo divertido y amigable.': '🎵 Choose another name! In our orchestra we respect and look after each other. Try a fun, friendly nickname.',
  'Guardar': 'Save', 'Cancelar': 'Cancel', 'Ingresá el código de sala': 'Enter the room code', 'Ej: MUSICA7': 'E.g. MUSICA7', 'Unirme': 'Join',
  // Misiones
  'MISIONES': 'MISSIONS', 'DESAFÍO DESTACADO': 'FEATURED CHALLENGE',
  'Jugá una ronda de Seguir el Ritmo y tratá de superar tu propio récord.': 'Play a round of Follow the Rhythm and try to beat your own record.',
  'El puntaje depende de tu partida. No hay bonus ni racha diaria configurados.': 'Your score depends on your game. There is no daily bonus or streak.',
  '🎻 Conocé la orquesta real': '🎻 Meet the real orchestra',
  '← Volver al menú': '← Back to menu', '← VOLVER AL MENÚ': '← BACK TO MENU', 'Volver': 'Back', '← VOLVER': '← BACK', 'Menú': 'Menu', '← MENÚ': '← MENU', '⌂ MENÚ': '⌂ MENU',
  // Créditos
  'OMITIR »': 'SKIP »', 'ORQUESTA ESCUELA': 'ORCHESTRA SCHOOL', 'UNA AVENTURA MUSICAL': 'A MUSICAL ADVENTURE',
  'UNA CREACIÓN DE': 'A CREATION BY',
  'IDEA ORIGINAL, CREACIÓN Y DIRECCIÓN': 'ORIGINAL IDEA, CREATION AND DIRECTION',
  'CONCEPTO EDUCATIVO Y DISEÑO DE LA EXPERIENCIA': 'EDUCATIONAL CONCEPT AND EXPERIENCE DESIGN',
  'DESARROLLO CON ASISTENCIA DE INTELIGENCIA ARTIFICIAL': 'DEVELOPED WITH ARTIFICIAL INTELLIGENCE ASSISTANCE',
  'Rosebud AI y ChatGPT': 'Rosebud AI and ChatGPT',
  'INSPIRADO EN LA': 'INSPIRED BY',
  'PROVINCIA DE BUENOS AIRES — ARGENTINA': 'BUENOS AIRES PROVINCE — ARGENTINA',
  'NUESTROS MÚSICOS': 'OUR MUSICIANS',
  '“Este videojuego nació para acercar la música a las nuevas generaciones y demostrar que todos podemos formar parte de una orquesta.': '“This video game was born to bring music closer to new generations and to show that we can all be part of an orchestra.',
  'Porque la música no solamente se aprende: también se comparte, se disfruta y nos ayuda a crecer”.': 'Because music is not only learned: it is also shared, enjoyed, and it helps us grow.”',
  'LA MÚSICA ES UNA AVENTURA QUE TODOS PODEMOS VIVIR': 'MUSIC IS AN ADVENTURE WE CAN ALL LIVE',
  'Un videojuego nacido en la Orquesta Escuela de Florencio Varela, Buenos Aires, Argentina. Creado por Sebastián Nahuel Mendizábal.': 'A video game born at Orquesta Escuela de Florencio Varela, Buenos Aires, Argentina. Created by Sebastián Nahuel Mendizábal.',
  // Configuración
  'CONFIGURACIÓN': 'SETTINGS', 'BIENVENIDA ANIMADA': 'ANIMATED WELCOME', 'Al iniciar una nueva sesión': 'When starting a new session',
  '💾 Partida guardada solo en este dispositivo · nube no configurada': '💾 Game saved on this device only · cloud not configured',
  'Reproducir al iniciar: SÍ': 'Play on start: YES', 'Reproducir al iniciar: NO': 'Play on start: NO',
  'Podés volver a ver la presentación desde acá cuando quieras.': 'You can watch the intro again from here whenever you want.',
  '▶  VER BIENVENIDA': '▶  WATCH WELCOME', '🎭  VER CRÉDITOS': '🎭  CREDITS', '🗑  BORRAR PERFIL LOCAL': '🗑  DELETE LOCAL PROFILE',
  'IDIOMA': 'LANGUAGE',
  // Perfil
  'PRÓXIMAMENTE': 'COMING SOON', 'MI PERFIL MUSICAL': 'MY MUSICAL PROFILE', '✓  GUARDAR MI PERFIL': '✓  SAVE MY PROFILE',
  'ACCESORIOS · DESBLOQUEOS POR LOGROS': 'ACCESSORIES · UNLOCKED BY ACHIEVEMENTS', 'VESTUARIO': 'OUTFIT',
  'Deslizá para ver todas las opciones': 'Swipe to see all options', 'INSIGNIAS OBTENIDAS': 'BADGES EARNED',
  'AVATAR': 'AVATAR', 'INSTRUMENTO': 'INSTRUMENT', 'INSTRUMENTO FAVORITO': 'FAVORITE INSTRUMENT', 'COMPOSITOR': 'COMPOSER', 'COMPOSITOR FAVORITO': 'FAVORITE COMPOSER',
  'Auriculares': 'Headphones', 'Moño': 'Bow tie', 'Gorra': 'Cap', 'Anteojos': 'Glasses',
  'Traje de concierto': 'Concert suit', 'Ropa urbana': 'Streetwear', 'Uniforme musical': 'Music uniform',
  'Zorro': 'Fox', 'Nutria': 'Otter', 'Búho': 'Owl', 'Gato': 'Cat', 'Perro': 'Dog', 'Panda': 'Panda', 'Conejo': 'Rabbit', 'León': 'Lion',
  'Sebastián, el zorro director': 'Sebastián, the fox conductor', 'Nutria violinista': 'Violinist otter', 'Búho profesor': 'Professor owl',
  // Premios
  'PREMIOS': 'AWARDS', 'RANKING': 'LEADERBOARD', '¡Desbloqueado!': 'Unlocked!',
  'Aprendiz de Corchea': 'Eighth-Note Apprentice', 'Semicorchea Veloz': 'Speedy Sixteenth', 'Atril de Plata': 'Silver Music Stand',
  'Solista Estrella': 'Star Soloist', 'Concertino Brillante': 'Brilliant Concertmaster', 'Maestro Musical': 'Music Master',
  'Batuta de Oro': 'Golden Baton', 'Genio Mozart': 'Mozart Genius', 'Leyenda Beethoven': 'Beethoven Legend',
  'Todavía nadie jugó. ¡Ganá el primer puesto!': 'Nobody has played yet. Take first place!',
  'Sin ranking guardado todavía. Conectate para verlo.': 'No saved leaderboard yet. Go online to see it.',
  '¡Jugá para entrar al ranking!': 'Play to get on the leaderboard!',
  'Dirigir la Orquesta': 'Conduct the Orchestra', 'Seguir el Ritmo': 'Follow the Rhythm', 'Desafío Sinfónico': 'Symphonic Challenge', 'Rosco Musical': 'Musical Wheel',
  'Arrastrá la batuta siguiendo el compás': 'Drag the baton following the beat', 'Tocá las notas sobre la línea dorada': 'Tap the notes on the golden line',
  'Trivia: historia y lenguaje musical': 'Trivia: history and music theory', 'Un desafío musical para cada letra': 'A musical challenge for every letter',
  // Clase
  'CLASE MUSICAL': 'MUSIC CLASS', 'Clase musical': 'Music class',
  'Historia musical · instrumentos · lenguaje · ritmos argentinos': 'Music history · instruments · theory · Argentine rhythms',
  'Sebastián, el zorro director, te acompaña en cada reto.': 'Sebastián, the fox conductor, joins you in every challenge.',
  '🎻 CONOCÉ TU INSTRUMENTO': '🎻 MEET YOUR INSTRUMENT', 'CONOCÉ TU INSTRUMENTO': 'MEET YOUR INSTRUMENT',
  'Elegí un instrumento de la orquesta': 'Choose an orchestra instrument', 'Volver a clases': 'Back to classes',
  'UN POCO DE HISTORIA': 'A BIT OF HISTORY', '¿CÓMO SE TOCA?': 'HOW IS IT PLAYED?', '← Instrumentos': '← Instruments',
  'Repetir trivia': 'Repeat trivia', 'Otras clases': 'Other classes', '▶ Empezar clase': '▶ Start class', 'Repetir clase': 'Repeat class',
  '↻ Escuchar de nuevo': '↻ Listen again', '¡Correcto! ★': 'Correct! ★', '¡Buen intento!': 'Nice try!',
  'Ver resultado ▶': 'See result ▶', 'Siguiente pregunta ▶': 'Next question ▶', 'Siguiente curiosidad ▶': 'Next fun fact ▶',
  'Empezar lenguaje musical ▶': 'Start music theory ▶', 'Ver resultado': 'See result', 'Siguiente ▶': 'Next ▶',
  'TA = negra  ·  ti-ti = dos corcheas  ·  silencio = pausa': 'TA = quarter note  ·  ti-ti = two eighth notes  ·  rest = pause',
  'Las notas suben y bajan sobre las líneas y espacios.': 'Notes go up and down on the lines and spaces.',
  'Historia musical': 'Music history', 'Curiosidades de instrumentos': 'Instrument fun facts', 'Lenguaje musical': 'Music theory',
  'Ritmos argentinos': 'Argentine rhythms', 'Lenguaje: arpegio DO–MI–SOL–DO': 'Theory: C–E–G–C arpeggio',
  'Historia de la música': 'History of music', 'Instrumentos de la orquesta': 'Orchestra instruments',
  'Historia musical: folklore y tango': 'Music history: folklore and tango', 'Lectura y alturas': 'Reading and pitch',
  'Leé el arpegio ascendente DO₄, MI₄, SOL₄ y DO₅. Las notas aparecen en su lugar correcto en el pentagrama: escuchá y repetí el eco.': 'Read the rising arpeggio C4, E4, G4 and C5. The notes appear in their correct place on the staff: listen and repeat the echo.',
  'Sebastián pregunta': 'Sebastián asks',
  // Selección de juego
  'Elegí compás, nivel y escenario': 'Choose time signature, level and stage',
  'Seguí la figura con tu batuta: el 1 dorado marca el pulso fuerte.': 'Follow the pattern with your baton: the golden 1 marks the strong beat.',
  '▶ ¡A dirigir!': '▶ Let’s conduct!', 'Elegí nivel y escenario': 'Choose level and stage', '▶ ¡A jugar!': '▶ Let’s play!',
  '🎭 Elegí el escenario (3 libres · desbloqueá los demás ganando)': '🎭 Choose the stage (3 free · win to unlock the rest)',
  'Libre': 'Free', 'Fácil': 'Easy', 'Medio': 'Medium', 'Difícil': 'Hard', 'Dificultad': 'Difficulty',
  'Viena': 'Vienna', 'Milán': 'Milan', 'Ópera de Sídney': 'Sydney Opera House',
  'abajo': 'down', 'arriba': 'up', 'afuera': 'out', 'adentro': 'in',
  // Juegos
  'Sebastián prepara el próximo desafío…': 'Sebastián is preparing the next challenge…',
  'Escuchá el ejemplo musical…': 'Listen to the musical example…', '↻ Repetir ejemplo': '↻ Repeat example',
  '↻ Escuchar otra vez': '↻ Listen again', 'Preparando el próximo ejemplo…': 'Preparing the next example…',
  '¡Orquesta completa!': 'Orchestra complete!', '¡Episodio superado!': 'Episode cleared!', 'Finalizar': 'Finish', 'Siguiente episodio': 'Next episode',
  'Escuchaste, comparaste y reconociste los patrones. ¿Listo para aumentar la dificultad?': 'You listened, compared and recognized the patterns. Ready to raise the difficulty?',
  'Preguntas musicales · 4 opciones · sumá puntos': 'Music questions · 4 options · score points',
  'Recorré las letras del rosco y elegí la respuesta correcta en cada desafío.': 'Go around the letter wheel and choose the right answer in each challenge.',
  'Elegí un tópico': 'Choose a topic', '¿Cómo querés jugar?': 'How do you want to play?',
  '✓ En solitario': '✓ Solo', 'En solitario': 'Solo', '✓ Duelo online': '✓ Online duel', 'Duelo online': 'Online duel',
  'Crear / unirme a una sala': 'Create / join a room',
  'Una persona crea una sala y comparte el código con su rival.': 'One player creates a room and shares the code with their rival.',
  'DUELO MUSICAL': 'MUSIC DUEL', '¡Competí en tiempo real con otra cuenta!': 'Compete in real time with another account!',
  'Una persona crea una sala y comparte el código; la otra lo ingresa para unirse.': 'One player creates a room and shares the code; the other enters it to join.',
  '＋ Crear sala nueva': '＋ Create new room', '🔑 Ingresar código': '🔑 Enter code',
  'SALA DE COMPETENCIA': 'COMPETITION ROOM', 'Compartí este código con el otro jugador': 'Share this code with the other player',
  'Esperando al segundo músico…': 'Waiting for the second musician…',
  '¡Ya están los dos! Esperá a que el anfitrión comience.': 'You’re both here! Wait for the host to start.',
  '▶ ¡Comenzar duelo!': '▶ Start duel!', 'Salir de la sala': 'Leave the room', 'Preparando la pregunta…': 'Preparing the question…',
  '¡Respuesta enviada! Esperando al rival…': 'Answer sent! Waiting for your rival…',
  '¡Siguiente pregunta en breve!': 'Next question coming up!', '¡Vamos con la próxima!': 'On to the next one!',
  'Girando la ruleta…': 'Spinning the wheel…', 'ROSCO MUSICAL': 'MUSICAL WHEEL', 'Desafío musical': 'Musical challenge', 'DUELO': 'DUEL',
  '🔁 Escuchar timbre': '🔁 Listen to the timbre', 'escuchá y elegí': 'listen and choose',
  'Pista: prestá atención al timbre y a la familia.': 'Hint: pay attention to the timbre and the family.',
  'Mirá el color de cada cuerda y el aro: ahí aterriza su corchea.': 'Watch each string’s color and ring: that’s where its eighth note lands.',
  'Escuchar ejemplo': 'Listen to example', '¡BRAVO!': 'BRAVO!',
  '🎻 Conocé la Orquesta Escuela real': '🎻 Meet the real Orquesta Escuela', '🔁 Revancha': '🔁 Rematch',
  'Preparados…': 'Ready…', 'JUEGO EN PAUSA': 'GAME PAUSED', '▶ CONTINUAR': '▶ CONTINUE',
  '¡Sebastián te desafía!': 'Sebastián challenges you!', '¡Girá el rosco!': 'Spin the wheel!', 'Sebastián te espera': 'Sebastián is waiting for you',
  '¡Sebastián te pregunta!': 'Sebastián asks you!', '¡Sebastián te enseña!': 'Sebastián teaches you!',
  '¡Respuesta correcta!': 'Correct answer!', '¡Se acabó el tiempo!': 'Time’s up!', '¡Probá la próxima!': 'Try the next one!',
  '¡A por la próxima!': 'On to the next!', '¡Bien!': 'Good!', '¡Correcto!': 'Correct!', 'Escuchá la diferencia': 'Hear the difference',
  'Fuera de compás': 'Off beat', '¡Pulso fuerte!': 'Strong beat!', '¡Perfecto!': 'Perfect!', '¡Ups!': 'Oops!',
  '¡Eco perfecto!': 'Perfect echo!', '¡Casi!': 'Almost!',
  '👆 Tocá y seguí la luz con tu batuta': '👆 Tap and follow the light with your baton',
  'Llevá la batuta a cada número cuando llega la luz': 'Move the baton to each number when the light arrives',
  'Los sonidos estaban, pero cuidá el espacio entre ellos.': 'The sounds were there, but watch the space between them.',
  '¿Cuántos pulsos escuchaste?': 'How many beats did you hear?', '¿Qué dirección siguió la melodía?': 'Which way did the melody go?',
  '¿Qué patrón rítmico escuchaste?': 'Which rhythmic pattern did you hear?',
  'Nivel 7 · armamos la orquesta': 'Level 7 · let’s build the orchestra', 'Nivel inicial · un pulso de marca': 'First level · one marker beat',
  'Nivel 2 · pulsos regulares': 'Level 2 · steady beats', 'Nivel 5 · melodía de 3 notas': 'Level 5 · 3-note melody',
  'Nivel 6 · melodía de 4 notas': 'Level 6 · 4-note melody', 'Nivel 3 · síncopas y subdivisiones': 'Level 3 · syncopation and subdivisions',
  'Nivel 4 · tres tiempos, silencios y subdivisiones': 'Level 4 · three beats, rests and subdivisions',
  'silencio': 'rest',
  '¡Hola! Soy Sebastián, el zorro director. Empecemos con una marca clara; escuchá el golpe y contá el pulso.': 'Hi! I’m Sebastián, the fox conductor. Let’s start with a clear marker: listen to the hit and count the beat.',
  '¡Muy bien! Ahora alternaré golpes regulares. Prestá atención a cuántos pulsos escuchás.': 'Very good! Now I’ll play steady hits. Pay attention to how many beats you hear.',
  'Llegamos a los ritmos. Yo soy Sebastián, tu director, y voy a tocar patrones con pulsos y sonidos dobles.': 'Here come the rhythms. I’m Sebastián, your conductor, and I’ll play patterns with beats and double sounds.',
  '¡A seguir! Ahora escucharás ritmos en tres tiempos, con subdivisiones y silencios.': 'Keep going! Now you’ll hear rhythms in three beats, with subdivisions and rests.',
  '¡Aventura melódica! Escuchá cómo cambian las notas: cuando el sonido se vuelve más agudo, la melodía sube.': 'Melodic adventure! Listen to how the notes change: when the sound gets higher, the melody goes up.',
  '¡Gran final musical! Las melodías tienen más notas. Seguí con el oído si suben o bajan.': 'Grand musical finale! The melodies have more notes. Follow with your ear whether they go up or down.',
  'Última misión: ayudame a ordenar la orquesta. ¿En qué sector se ubica cada instrumento?': 'Final mission: help me arrange the orchestra. Where does each instrument sit?',
  'Adelante · izquierda': 'Front · left', 'Adelante · centro': 'Front · center', 'Atrás · centro': 'Back · center',
  'Adelante · junto a las maderas': 'Front · next to the woodwinds', 'Al fondo · lateral': 'Back · side',
  'Las cuerdas suelen ubicarse adelante, a la izquierda.': 'Strings usually sit at the front, on the left.',
  'Las maderas suelen ubicarse adelante, en el centro.': 'Woodwinds usually sit at the front, in the center.',
  'Los metales suelen ubicarse detrás de las maderas.': 'Brass usually sits behind the woodwinds.',
  'El bandoneón es un instrumento de fuelle; su lugar depende de la obra y el arreglo.': 'The bandoneon is a bellows instrument; its place depends on the piece and the arrangement.',
  'La percusión suele ubicarse al fondo, para tener espacio.': 'Percussion usually sits at the back, to have room.',
  // Instrumentos
  'Violín': 'Violin', 'Trompeta': 'Trumpet', 'Flauta': 'Flute', 'Timbal': 'Timpani', 'Cello': 'Cello', 'Clarinete': 'Clarinet',
  'Viola': 'Viola', 'Contrabajo': 'Double bass', 'Oboe': 'Oboe', 'Fagot': 'Bassoon', 'Trombón': 'Trombone', 'Bandoneón': 'Bandoneon',
  'Violonchelo': 'Cello', 'Percusión': 'Percussion', 'Corno': 'French horn', 'Tuba': 'Tuba',
  'Cuerdas frotadas': 'Bowed strings', 'Viento-metal': 'Brass', 'Viento-madera': 'Woodwinds', 'Viento-fuelle': 'Bellows',
  'Registro agudo y brillante; el arco hace vibrar sus cuerdas.': 'High, bright register; the bow makes its strings vibrate.',
  'Timbre potente y claro; el sonido nace en los labios.': 'Powerful, clear timbre; the sound starts at the lips.',
  'Sonido aireado y luminoso; se sopla por una embocadura.': 'Airy, luminous sound; you blow across a mouthpiece.',
  'Tambor de tono definido: se toca con mazas.': 'A drum with a definite pitch, played with mallets.',
  'Sonido cálido y grave; se toca sentado, entre las rodillas.': 'Warm, low sound; played seated, between the knees.',
  'Timbre redondo y flexible; tiene una lengüeta simple.': 'Round, flexible timbre; it has a single reed.',
  'Suena más grave y oscuro que el violín; también se toca con arco.': 'Sounds lower and darker than the violin; also played with a bow.',
  'Es el más grande de las cuerdas y sostiene los sonidos más graves.': 'The largest string instrument, holding the lowest sounds.',
  'Timbre penetrante y expresivo; usa una doble lengüeta.': 'Penetrating, expressive timbre; it uses a double reed.',
  'Tubo largo de sonido grave y cálido; usa doble lengüeta.': 'Long tube with a low, warm sound; it uses a double reed.',
  'El tubo se alarga o acorta con una vara deslizante.': 'The tube gets longer or shorter with a sliding slide.',
  'Instrumento de fuelle, esencial en el tango argentino; su sonido nace al abrir y cerrar el aire.': 'A bellows instrument, essential in Argentine tango; its sound comes from opening and closing the air.',
  'El violín moderno tomó forma en el norte de Italia durante el siglo XVI. Su sonido viajó desde las primeras orquestas barrocas hasta la música actual.': 'The modern violin took shape in northern Italy in the 16th century. Its sound traveled from the first Baroque orchestras to today’s music.',
  'CUERDAS, de grave a aguda: SOL, RE, LA y MI. El arco, con crines tensadas y resina, frota las cuerdas para hacerlas vibrar. También se puede tocar pizzicato: pellizcá la cuerda con un dedo, sin usar el arco.': 'STRINGS, from low to high: G, D, A and E. The bow, with tightened hair and rosin, rubs the strings to make them vibrate. You can also play pizzicato: pluck the string with a finger, without the bow.',
  'El violonchelo pertenece a la familia del violín y se desarrolló en Italia en el siglo XVI. Se toca sentado, apoyado en una pica que descansa en el suelo.': 'The cello belongs to the violin family and developed in Italy in the 16th century. It is played seated, resting on an endpin on the floor.',
  'CUERDAS, de grave a aguda: DO, SOL, RE y LA. El arco frota las cuerdas para sostener y colorear el sonido. En pizzicato, pulsás la cuerda con un dedo para obtener un sonido corto y definido.': 'STRINGS, from low to high: C, G, D and A. The bow rubs the strings to sustain and color the sound. In pizzicato, you pluck the string with a finger for a short, clear sound.',
  'La viola es una de las voces centrales de la familia de cuerdas frotadas. Comparte la historia de los instrumentos de arco que se consolidaron en Europa en el siglo XVI.': 'The viola is one of the middle voices of the bowed string family. It shares the history of bowed instruments that became established in Europe in the 16th century.',
  'CUERDAS, de grave a aguda: DO, SOL, RE y LA. El arco pone las cuerdas en vibración al frotarlas; con pizzicato, las pulsás con un dedo. Su registro suele ser más grave que el del violín.': 'STRINGS, from low to high: C, G, D and A. The bow sets the strings vibrating; with pizzicato, you pluck them with a finger. Its range is usually lower than the violin’s.',
  'El contrabajo desciende de grandes instrumentos graves de cuerda europeos del siglo XVI. En la orquesta sostiene el pulso y la base armónica.': 'The double bass descends from large, low European string instruments of the 16th century. In the orchestra it holds the pulse and the harmonic foundation.',
  'AFINACIÓN habitual de sus cuatro cuerdas, de grave a aguda: MI, LA, RE y SOL. Se toca con arco o pizzicato: el dedo pulsa la cuerda y produce el característico “plum” grave. Es el instrumento más grande de las cuerdas de la orquesta.': 'Usual TUNING of its four strings, from low to high: E, A, D and G. It is played with a bow or pizzicato: the finger plucks the string for that typical low “plum”. It is the largest string instrument in the orchestra.',
  'Las flautas existen desde la antigüedad; la flauta traversa moderna fue perfeccionada en el siglo XIX con un sistema de llaves. Aunque suele ser de metal, pertenece a viento-madera por su manera de producir el sonido.': 'Flutes have existed since ancient times; the modern transverse flute was perfected in the 19th century with a key system. Although usually made of metal, it is a woodwind because of how it produces sound.',
  'No tiene caña. Para hacerla sonar, apoyá el borde del orificio junto al labio inferior y dirigí un hilo de aire hacia el borde opuesto, como al soplar una botella. Cambiá las notas abriendo y cerrando las llaves.': 'It has no reed. To play it, rest the edge of the hole against your lower lip and aim a thin stream of air at the opposite edge, like blowing across a bottle. Change notes by opening and closing the keys.',
  'El clarinete se desarrolló en Europa alrededor del siglo XVIII a partir de instrumentos anteriores como el chalumeau. Puede pasar de un registro grave y oscuro a otro brillante.': 'The clarinet developed in Europe around the 18th century from earlier instruments like the chalumeau. It can move from a dark low register to a bright one.',
  'Usa CAÑA SIMPLE: una lengüeta de caña se sujeta a la boquilla. Apoyá suavemente el labio inferior en la caña, cerrá los labios alrededor de la boquilla y soplá; los dedos accionan las llaves para cambiar las notas.': 'It uses a SINGLE REED fastened to the mouthpiece. Rest your lower lip gently on the reed, close your lips around the mouthpiece and blow; your fingers work the keys to change notes.',
  'El oboe moderno evolucionó de instrumentos de doble lengüeta como la chirimía y se consolidó durante el Barroco. Su timbre claro ayuda a afinar a toda la orquesta con la nota LA.': 'The modern oboe evolved from double-reed instruments like the shawm and became established in the Baroque. Its clear timbre helps the whole orchestra tune to the note A.',
  'Usa CAÑA DOBLE: dos láminas de caña vibran una contra otra. Se apoyan los labios alrededor de la caña y se sopla con aire sostenido y controlado. La vibración de las dos láminas produce su sonido penetrante.': 'It uses a DOUBLE REED: two blades of cane vibrate against each other. You place your lips around the reed and blow with steady, controlled air. The vibration of the two blades makes its penetrating sound.',
  'El fagot evolucionó de instrumentos graves de doble lengüeta del Renacimiento, como el bajón. Su tubo largo se pliega para que el instrumento pueda tocarse cómodamente.': 'The bassoon evolved from low Renaissance double-reed instruments like the dulcian. Its long tube is folded so it can be played comfortably.',
  'Usa CAÑA DOBLE, parecida a la del oboe pero montada en un tudel curvo. La caña vibra cuando soplás entre sus dos láminas; las llaves ayudan a tocar sus notas graves y cálidas.': 'It uses a DOUBLE REED, like the oboe’s but mounted on a curved bocal. The reed vibrates when you blow between its two blades; the keys help play its low, warm notes.',
  'Las trompetas antiguas se usaban en ceremonias y señales. La trompeta con pistones, que permite tocar muchas notas, se desarrolló durante el siglo XIX.': 'Ancient trumpets were used for ceremonies and signals. The valved trumpet, which can play many notes, was developed in the 19th century.',
  'No usa caña. Apoyá la boquilla en los labios, hacé vibrar los labios con un “brrr” suave y agregá aire constante. Los pistones cambian la longitud del tubo y, junto con los labios, permiten cambiar la nota.': 'It has no reed. Put the mouthpiece to your lips, buzz them with a gentle “brrr” and add steady air. The valves change the tube length and, together with your lips, change the note.',
  'El trombón desciende del sacabuche, instrumento de vara muy usado en Europa desde el Renacimiento. Su forma actual conserva la corredera para cambiar la longitud del tubo.': 'The trombone descends from the sackbut, a slide instrument widely used in Europe since the Renaissance. Its current form keeps the slide to change the tube length.',
  'No usa caña: el sonido nace al hacer vibrar los labios contra la boquilla. Sopla con aire parejo y desliza la vara hacia distintas posiciones para cambiar la altura de las notas.': 'It has no reed: the sound comes from buzzing the lips against the mouthpiece. Blow with even air and move the slide to different positions to change the pitch.',
  'Los timbales orquestales evolucionaron de grandes tambores de caldera usados en Europa desde hace siglos. Se incorporaron a la orquesta y fueron ganando afinación regulable.': 'Orchestral timpani evolved from large kettle drums used in Europe for centuries. They joined the orchestra and gained adjustable tuning.',
  'Se toca con dos baquetas o mazas, golpeando el parche con control. Los pedales tensan o aflojan el parche para cambiar la afinación; así puede tocar notas definidas, no solo golpes.': 'It is played with two sticks or mallets, striking the head with control. Pedals tighten or loosen the head to change the tuning, so it can play definite notes, not just hits.',
  'El bandoneón nació en Alemania en el siglo XIX y llegó al Río de la Plata, donde se volvió una de las voces emblemáticas del tango.': 'The bandoneon was born in Germany in the 19th century and arrived in the Río de la Plata, where it became one of the iconic voices of tango.',
  'No usa caña de madera: tiene lengüetas metálicas libres que vibran con el aire. Abrí y cerrá el fuelle mientras accionás los botones; el mismo botón puede dar notas distintas al abrir o cerrar.': 'It has no cane reed: it has free metal reeds that vibrate with the air. Open and close the bellows while pressing the buttons; the same button can give different notes when opening or closing.',
  // Bienvenida e invitación
  '¡BIENVENIDOS!': 'WELCOME!', 'A NUESTRA ORQUESTA ESCUELA': 'TO OUR ORCHESTRA SCHOOL', 'SALTAR': 'SKIP',
  '¡Bienvenidos a nuestra Orquesta Escuela!': 'Welcome to our Orchestra School!',
  'TOCÁ EL GLOBO PARA SEGUIR  ›': 'TAP THE BUBBLE TO CONTINUE  ›', 'AVISO': 'NOTICE',
  '¡BRAVO, CONCERTISTA!': 'BRAVO, CONCERT ARTIST!', '¡LA MÚSICA NOS UNE!': 'MUSIC BRINGS US TOGETHER!',
  'Elegí cómo conocer más de la orquesta:': 'Choose how to learn more about the orchestra:',
  '¡Quiero conocer la orquesta!': 'I want to meet the orchestra!', 'Ver nuestros conciertos': 'Watch our concerts', 'Seguir jugando': 'Keep playing',
  'Abrir enlace': 'Open link', 'Ahora no': 'Not now',
  'Vas a salir del videojuego para visitar un sitio externo. No te pediremos ni guardaremos datos personales. Si sos menor de edad, pedí ayuda a una persona adulta responsable. ¿Querés continuar?': 'You are about to leave the game to visit an external site. We will not ask for or store personal data. If you are a minor, ask a responsible adult for help. Do you want to continue?',
  '¡Bravo! ¡Tu primer concierto fue increíble!': 'Bravo! Your first concert was amazing!',
  '¿Sabías que también podés vivir esta aventura en una orquesta de verdad?': 'Did you know you can also live this adventure in a real orchestra?',
  '¡Sumate a los más de 1000 integrantes de nuestra Orquesta Escuela de Florencio Varela!': 'Join the more than 1,000 members of our Orquesta Escuela in Florencio Varela, Argentina!',
  'Si querés aprender a tocar un instrumento, pedile a tu familia que nos escriba por nuestras redes sociales.': 'If you want to learn to play an instrument, ask your family to message us on our social media.',
  '¡DEJÁ DE JUGAR SOLO': 'DON’T JUST PLAY', 'EN LA PANTALLA Y VENÍ': 'ON THE SCREEN — COME', 'A TOCAR CON NOSOTROS!': 'AND PLAY WITH US!',
  '¡DEJÁ DE JUGAR SOLO EN LA PANTALLA': 'DON’T JUST PLAY ON THE SCREEN', 'Y VENÍ A TOCAR CON NOSOTROS!': 'COME AND PLAY WITH US!',
  '¡Sumate a los más de 1000 integrantes de nuestra Orquesta Escuela!': 'Join the more than 1,000 members of our Orquesta Escuela!',
  'NUESTRA ORQUESTA, MUCHOS INSTRUMENTOS': 'OUR ORCHESTRA, MANY INSTRUMENTS',
  '¡La música también se vive fuera del juego! Conocé nuestra Orquesta Escuela de Florencio Varela y descubrí cómo formar parte de una verdadera orquesta.': 'Music also lives outside the game! Meet our Orquesta Escuela in Florencio Varela, Argentina, and discover how to be part of a real orchestra.',
  'VOLVER A JUGAR': 'BACK TO THE GAME', '¡QUIERO SUMARME!': 'I WANT TO JOIN!', '← CONOCÉ LA ORQUESTA': '← MEET THE ORCHESTRA',
  'Si sos menor de edad, pedile ayuda a una persona adulta responsable para comunicarte con nuestra escuela.': 'If you are a minor, ask a responsible adult to help you contact our school.',
  '📍 ESCUELA N.º 501': '📍 SCHOOL No. 501', 'Chacabuco 68 — Florencio Varela': 'Chacabuco 68 — Florencio Varela',
  'Provincia de Buenos Aires': 'Buenos Aires, Argentina', '📍 CÓMO LLEGAR': '📍 DIRECTIONS', '¿QUERÉS SER PARTE?': 'WANT TO JOIN?',
  'Comunicate con nosotros a través de nuestras redes sociales para consultar cómo inscribirte y comenzar tu aventura musical.': 'Contact us through our social media to ask how to enroll. In-person enrollment is in Florencio Varela, Buenos Aires, Argentina.',
  'YouTube permite conocer la actividad de la orquesta. Consultas de inscripción: Instagram o Facebook.': 'YouTube shows the orchestra’s activities. Enrollment questions: Instagram or Facebook.',
  // Escape de Salieri
  'ESCUDO MUSICAL': 'MUSIC SHIELD', 'PAUSA MUSICAL': 'MUSICAL PAUSE', '¡FIN DEL CONCIERTO!': 'END OF THE CONCERT!',
  '↻ REINTENTAR': '↻ RETRY', '🏆 CLASIFICACIÓN': '🏆 LEADERBOARD', 'CLASIFICACIÓN · ESCAPE': 'LEADERBOARD · ESCAPE',
  'Jugá tu primera carrera para estrenar la tabla.': 'Play your first run to open the table.',
  'Partidas locales y resultados globales disponibles': 'Local games and global results available',
  'Mejores partidas guardadas en este dispositivo': 'Best games saved on this device',
  'Se muestran también resultados online recibidos.': 'Online results received are also shown.',
  'Guardado local · ranking entre dispositivos requiere un servicio online configurado.': 'Saved locally · cross-device leaderboard requires an online service.',
  '¡GIRÁ TU DISPOSITIVO!': 'ROTATE YOUR DEVICE!', 'Este desafío se juega en horizontal': 'This challenge is played in landscape',
  'GIRÁ TU TELÉFONO': 'ROTATE YOUR PHONE', 'Este juego se disfruta en formato vertical': 'This game is best in portrait mode',
  '¡BRAVO, GRAN MÚSICO!': 'BRAVO, GREAT MUSICIAN!', '¡SALIERI ES TU ALIADO!': 'SALIERI IS YOUR ALLY!', 'UN DATO MUSICAL': 'A MUSIC FACT',
  '¡BRAVO! ¡DEMOSTRASTE SER UN GRAN MÚSICO!': 'BRAVO! YOU PROVED YOU ARE A GREAT MUSICIAN!',
  '¡DESDE AHORA SOMOS AMIGOS! ¡CORRAMOS AL MISMO RITMO!': 'FROM NOW ON WE’RE FRIENDS! LET’S RUN TO THE SAME BEAT!',
  'El verdadero Antonio Salieri fue un reconocido compositor y profesor de música. Su rivalidad con Mozart fue exagerada por la ficción.': 'The real Antonio Salieri was a respected composer and music teacher. His rivalry with Mozart was exaggerated by fiction.',
  'CONTINUAR  ▶': 'CONTINUE  ▶', 'SEGUIR JUGANDO': 'KEEP PLAYING',
  'Primeros 100 metros': 'First 100 meters', 'Sobreviviste 60 segundos · ¡doble salto desbloqueado!': 'You survived 60 seconds · double jump unlocked!',
  'Esquivaste 50 obstáculos': 'You dodged 50 obstacles', 'Superaste los tres desafíos de Salieri': 'You beat Salieri’s three challenges',
  '¡Mozart estaría orgulloso!': 'Mozart would be proud!', '¡Nuevo récord personal!': 'New personal record!',
  'ESCUELA DE MÚSICA': 'MUSIC SCHOOL', 'TEATRO CLÁSICO': 'CLASSIC THEATER', 'VIENA MUSICAL': 'MUSICAL VIENNA', 'GRAN CONCIERTO': 'GRAND CONCERT', 'GRAN FINAL': 'GRAND FINALE',
  '¡SOY SALIERI! ¡VEAMOS SI PODÉS SEGUIR EL RITMO!': 'I’M SALIERI! LET’S SEE IF YOU CAN KEEP THE BEAT!',
  '¡PRIMER DESAFÍO SUPERADO!': 'FIRST CHALLENGE CLEARED!', '¡NADA MAL! ¡PERO AHORA VIENE LO DIFÍCIL!': 'NOT BAD! BUT NOW COMES THE HARD PART!',
  '¡SEGUNDO DESAFÍO SUPERADO!': 'SECOND CHALLENGE CLEARED!', '¡ESTA SERÁ MI ÚLTIMA PRUEBA!': 'THIS WILL BE MY FINAL TEST!',
  '¡TERCER DESAFÍO SUPERADO!': 'THIRD CHALLENGE CLEARED!', '¡SALIERI TE AYUDA!': 'SALIERI HELPS YOU!', '¡DESAFÍO SUPERADO!': 'CHALLENGE CLEARED!',
  '¡CUIDADO! ¡LLEGA SALIERI!': 'WATCH OUT! SALIERI IS COMING!',
  '¡Partituras voladoras!': 'Flying sheet music!', '¡Más obstáculos musicales!': 'More musical obstacles!',
  '¡Final musical: cuatro obstáculos!': 'Musical finale: four obstacles!', '¡Soplido de humo violeta!': 'A puff of purple smoke!',
  '¡Acelero el tempo!': 'Speeding up the tempo!', '¡Una secuencia rítmica!': 'A rhythmic sequence!', '¡No tan rápido!': 'Not so fast!',
  '¡A correr!': 'Run!', '¡Preparáte!': 'Get ready!', '¡seguí el compás!': 'keep the beat!',
  // Herramientas: afinador, metrónomo, sponsors
  '← Volver': '← Back', '🎵 Afinador': '🎵 Tuner', '🥁 Metrónomo': '🥁 Metronome',
  'Tocá una nota': 'Play a note', 'Referencia: La4 = 440 Hz': 'Reference: A4 = 440 Hz',
  '🎤 Activar micrófono': '🎤 Turn on microphone', '⏹ Apagar micrófono': '⏹ Turn off microphone', '🔔 Prueba 440 Hz': '🔔 440 Hz test',
  'El sonido se analiza en tu dispositivo. No se graba ni se guarda.': 'Sound is analyzed on your device. It is never recorded or stored.',
  'Micrófono apagado al salir de la app.': 'Microphone turned off when leaving the app.',
  'Este navegador no permite usar el micrófono.': 'This browser does not allow microphone use.',
  'El micrófono necesita una conexión segura (HTTPS).': 'The microphone requires a secure connection (HTTPS).',
  'Pidiendo permiso para el micrófono…': 'Asking for microphone permission…', 'Escuchando… tocá una nota larga.': 'Listening… play a long note.',
  'Permiso denegado. Habilitá el micrófono en los ajustes del navegador o del teléfono.': 'Permission denied. Enable the microphone in your browser or phone settings.',
  'No se encontró ningún micrófono.': 'No microphone was found.', 'El micrófono está siendo usado por otra app.': 'The microphone is being used by another app.',
  'No se pudo activar el micrófono.': 'Could not turn on the microphone.',
  'Señal interna de 440 Hz (no usa micrófono ni suena).': 'Internal 440 Hz signal (no microphone, no sound).',
  'Micrófono apagado.': 'Microphone off.', 'Prueba detenida.': 'Test stopped.',
  'BPM (negra)': 'BPM (quarter note)', 'BPM (corchea) · grupos de 3': 'BPM (eighth note) · groups of 3',
  '👆 Tap Tempo': '👆 Tap Tempo', '★ Acento: Sí': '★ Accent: On', '☆ Acento: No': '☆ Accent: Off',
  '▶ Iniciar': '▶ Start', '⏸ Pausar': '⏸ Pause', '⏹ Detener': '⏹ Stop', '🔊 Volumen': '🔊 Volume', 'Volumen': 'Volume',
  '🤝 Nuestros sponsors y colaboradores': '🤝 Our sponsors and supporters',
  'Gracias a quienes acompañan nuestro proyecto y nos ayudan a seguir creando oportunidades a través de la música.': 'Thank you to everyone who supports our project and helps us keep creating opportunities through music.',
  'Próximamente conocerás a quienes hacen posible esta aventura.': 'Soon you’ll meet the people who make this adventure possible.',
  '💬 Quiero colaborar con la Orquesta Escuela': '💬 I want to support Orquesta Escuela',
  'Con el apoyo de': 'With the support of', 'Saltar ▶': 'Skip ▶',
  // Errores
  '🎻 Algo desafinó en la orquesta': '🎻 Something went out of tune in the orchestra',
};

// Patrones para textos con números o partes variables. Los grupos capturados se traducen a su vez.
const PATTERNS = [
  [/^NIVEL (\d+)$/, (m) => `LEVEL ${m[1]}`],
  [/^Nivel (\d+)$/, (m) => `Level ${m[1]}`],
  [/^EPISODIO (\S+)$/, (m) => `EPISODE ${m[1]}`],
  [/^DESAFÍO (\S+)$/, (m) => `CHALLENGE ${m[1]}`],
  [/^Compás (\S+)$/, (m) => `Time ${m[1]}`],
  [/^Tiempo: (.+)$/, (m) => `Time: ${m[1]}`],
  [/^Ronda (\S+)$/, (m) => `Round ${m[1]}`],
  [/^Código: (.+)$/, (m) => `Code: ${m[1]}`],
  [/^Récord: (.+)$/, (m) => `Best: ${m[1]}`],
  [/^Récord (.+)$/, (m) => `Best ${m[1]}`],
  [/^RÉC (.+)$/, (m) => `BEST ${m[1]}`],
  [/^Puesto #(\S+) del ranking$/, (m) => `Rank #${m[1]} on the leaderboard`],
  [/^(\S+) puntos$/, (m) => `${m[1]} points`],
  [/^Distancia (.+)$/, (m) => `Distance ${m[1]}`],
  [/^Notas (.+)$/, (m) => `Notes ${m[1]}`],
  [/^Obstáculos (.+)$/, (m) => `Obstacles ${m[1]}`],
  [/^MENSAJE (\d+) DE (\d+)$/, (m) => `MESSAGE ${m[1]} OF ${m[2]}`],
  [/^INSIGNIAS OBTENIDAS · (\d+)$/, (m) => `BADGES EARNED · ${m[1]}`],
  [/^Tenés (\S+) puntos en total$/, (m) => `You have ${m[1]} points in total`],
  [/^Faltan (\S+) XP para subir$/, (m) => `${m[1]} XP to level up`],
  [/^Acertaste (\d+) de (\d+)$/, (m) => `You got ${m[1]} of ${m[2]} right`],
  [/^Ejercicio (.+)$/, (m) => `Exercise ${m[1]}`],
  [/^Curiosidad (.+)$/, (m) => `Fun fact ${m[1]}`],
  [/^Era (.+)$/, (m) => `It was ${t(m[1])}`],
  [/^¡Letra (.+)!$/, (m) => `Letter ${m[1]}!`],
  [/^Tu mejor marca online: (.+)$/, (m) => `Your best online score: ${m[1]}`],
  [/^🎯 Rival a superar: (.+)$/, (m) => `🎯 Rival to beat: ${m[1]}`],
  [/^Premio desbloqueado: (\S+) (.+)$/, (m) => `Award unlocked: ${m[1]} ${t(m[2])}`],
  [/^Premio: (\S+) (.+)$/, (m) => `Award: ${m[1]} ${t(m[2])}`],
  [/^¡NUEVO PREMIO! (\S+) (.+)$/, (m) => `NEW AWARD! ${m[1]} ${t(m[2])}`],
  [/^Tu récord local: (\S+)$/, (m) => `Your local best: ${m[1]}`],
  [/^(\d+) puntajes? esperando sincronizar$/, (m) => `${m[1]} score${m[1] === '1' ? '' : 's'} waiting to sync`],
  [/^(\d+) pendientes?$/, (m) => `${m[1]} pending`],
  [/^(\d+) por sincronizar$/, (m) => `${m[1]} to sync`],
  [/^(.+) pts o (\d+) victorias$/, (m) => `${m[1].replace('.', ',')} pts or ${m[2]} wins`],
  [/^Eran (\d+) sonidos y tocaste (\d+)\. ¡Contá con el pulso!$/, (m) => `There were ${m[1]} sounds and you played ${m[2]}. Count with the beat!`],
];

const cache = new Map();
const PREFIX_RE = /^[^\p{L}\p{N}¡¿“"]+/u;
const SUFFIX_RE = /[\s▶»›★☆✔]+$/u;

function translateEn(str, depth) {
  if (Object.prototype.hasOwnProperty.call(EN, str)) return EN[str];
  if (depth > 3) return str;
  for (const [re, fn] of PATTERNS) {
    const m = str.match(re);
    if (m) return fn(m);
  }
  // Emoji/símbolo inicial o final: traducir el núcleo y conservar los adornos.
  const pre = str.match(PREFIX_RE)?.[0] || '';
  const suf = str.slice(pre.length).match(SUFFIX_RE)?.[0] || '';
  if (pre || suf) {
    const core = str.slice(pre.length, str.length - suf.length);
    if (core) {
      const tr = translateEn(core, depth + 1);
      if (tr !== core) return pre + tr + suf;
    }
  }
  // Textos compuestos con separador " · ": traducir cada parte.
  const sep = str.includes('  ·  ') ? '  ·  ' : str.includes(' · ') ? ' · ' : '';
  if (sep) {
    const parts = str.split(sep);
    const out = parts.map((p) => translateEn(p, depth + 1));
    if (out.some((p, i) => p !== parts[i])) return out.join(sep);
  }
  return str;
}

export function t(str) {
  if (lang === 'es' || typeof str !== 'string' || !str) return str;
  const hit = cache.get(str);
  if (hit !== undefined) return hit;
  const result = translateEn(str, 0);
  if (cache.size > 4000) cache.clear();
  cache.set(str, result);
  return result;
}

// Para pruebas automáticas.
export function translateFor(target, str) {
  if (target === 'es') return str;
  return translateEn(str, 0);
}
export const DICTIONARY_SIZE = Object.keys(EN).length;
