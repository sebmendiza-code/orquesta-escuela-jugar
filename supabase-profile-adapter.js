// Puente explícito entre el perfil local del juego y el perfil de Supabase.
// No se importa desde main.js y nunca escribe localStorage al consultar el perfil online.
import { getPlayerProfile, updatePlayerProfile } from './supabase-client.js';
import { SUPABASE_MAX_AVATAR_INDEX } from './supabase_config.js';

const LOCAL_NAME_KEY = 'oefv-name';
const LOCAL_PROFILE_KEY = 'oefv-profile';

function getStorage() {
  try { return globalThis.localStorage; } catch (error) { return null; }
}

/** Lee una instantánea local sin modificarla, incluyendo preferencias visuales locales. */
export function readLocalProfileSnapshot(storage = getStorage()) {
  if (!storage) return { name: null, avatar: null, preferences: null };
  let name = null;
  let preferences = null;
  try {
    const value = storage.getItem(LOCAL_NAME_KEY);
    name = typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch (error) { /* almacenamiento no disponible: solo devuelve datos desconocidos */ }
  try {
    const parsed = JSON.parse(storage.getItem(LOCAL_PROFILE_KEY) || 'null');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) preferences = parsed;
  } catch (error) { /* perfil local ausente o inválido */ }
  const rawAvatar = Number(preferences?.avatar);
  const avatar = Number.isInteger(rawAvatar) && rawAvatar >= 0 && rawAvatar <= SUPABASE_MAX_AVATAR_INDEX
    ? rawAvatar
    : null;
  return { name, avatar, preferences };
}

/**
 * Lee el perfil remoto y lo devuelve junto con la copia local para que una futura UI
 * resuelva diferencias de forma explícita. Lo local tiene prioridad en la sugerencia;
 * no se altera ningún valor local ni se actualiza automáticamente Supabase.
 */
export async function getSupabaseProfileContext() {
  const local = readLocalProfileSnapshot();
  const online = await getPlayerProfile();
  const hasConflict = Boolean(local.name && online.name && local.name !== online.name)
    || (local.avatar !== null && Number(online.avatar) !== local.avatar);
  return {
    userId: online.id,
    local,
    online,
    hasConflict,
    suggestedDisplayProfile: {
      name: local.name || online.name,
      avatar: local.avatar ?? online.avatar,
      source: local.name || local.avatar !== null ? 'local-first' : 'supabase-fallback',
    },
  };
}

/**
 * Publica solo apodo/avatar locales al perfil remoto, y únicamente cuando la UI futura
 * indique consentimiento explícito. No toca localStorage ni preferencias instrument/composer.
 * El booleano es una protección de flujo, no un mecanismo de seguridad; RLS sigue obligatoria.
 */
export async function updateSupabaseDisplayProfileFromLocal({ confirmed = false } = {}) {
  if (confirmed !== true) {
    const error = new Error('Se requiere confirmación explícita antes de publicar el perfil local.');
    error.code = 'SUPABASE_PROFILE_CONFIRMATION_REQUIRED';
    throw error;
  }
  const local = readLocalProfileSnapshot();
  if (!local.name || local.avatar === null) {
    const error = new Error('No hay un apodo y avatar local válidos para publicar.');
    error.code = 'SUPABASE_LOCAL_PROFILE_INVALID';
    throw error;
  }
  return updatePlayerProfile({ name: local.name, avatar: local.avatar });
}
