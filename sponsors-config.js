// Configuración de sponsors y colaboradores.
// Estado inicial: sin sponsors cargados y presentación inicial desactivada.
//
// Para agregar un sponsor en una próxima actualización, sumá un objeto así:
// {
//   id: 'mi-sponsor',              // identificador único
//   name: 'Nombre del sponsor',    // obligatorio
//   logo: 'assets/sponsors/mi-sponsor.webp', // opcional: si falta, no se muestra ningún espacio vacío
//   description: 'Descripción breve.',       // opcional
//   url: 'https://ejemplo.org',    // opcional: enlace externo (solo https)
//   order: 1,                      // orden de aparición (menor = primero)
//   confirmed: true,               // solo se muestran los confirmados
// }
export const SPONSORS = [];

// Presentación de sponsors al iniciar (después de la bienvenida, al llegar al menú).
// Nunca aparece si no hay sponsors confirmados, se puede saltar y se cierra sola.
export const SPONSOR_INTRO = {
  enabled: false,
  secondsPerSponsor: 2.5,
  maxSeconds: 8,
};

export const SPONSOR_WHATSAPP_URL = 'https://wa.me/541138029139?text=Hola%2C%20me%20gustar%C3%ADa%20recibir%20informaci%C3%B3n%20para%20colaborar%20como%20sponsor%20de%20Orquesta%20Escuela%3A%20Una%20Aventura%20Musical.';

export function getConfirmedSponsors() {
  return SPONSORS
    .filter((s) => s && s.confirmed === true && typeof s.name === 'string' && s.name.trim())
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}
