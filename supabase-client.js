// Cliente opcional de Supabase: Auth anónima persistente y perfil propio.
// No se importa desde main.js todavía. No escribe puntajes ni reemplaza InstantDB.
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_PLAYERS_TABLE,
  SUPABASE_PLAYER_ID_COLUMN,
  SUPABASE_PLAYER_NAME_COLUMN,
  SUPABASE_PLAYER_AVATAR_COLUMN,
  SUPABASE_MAX_AVATAR_INDEX,
} from './supabase_config.js';

let clientPromise = null;

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function validateConfiguration() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const error = new Error('Supabase no está configurado. Completá SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en supabase_config.js.');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    throw error;
  }
  let parsed;
  try { parsed = new URL(SUPABASE_URL); } catch (cause) {
    const error = new Error('SUPABASE_URL no es una URL válida.');
    error.code = 'SUPABASE_INVALID_URL';
    error.cause = cause;
    throw error;
  }
  const localHost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(localHost && parsed.protocol === 'http:')) {
    const error = new Error('SUPABASE_URL debe usar HTTPS (HTTP solo se admite en localhost).');
    error.code = 'SUPABASE_INSECURE_URL';
    throw error;
  }
  if (![SUPABASE_PLAYERS_TABLE, SUPABASE_PLAYER_ID_COLUMN, SUPABASE_PLAYER_NAME_COLUMN, SUPABASE_PLAYER_AVATAR_COLUMN].every(validIdentifier)) {
    const error = new Error('La configuración de nombres de tabla/campos de Supabase no es válida.');
    error.code = 'SUPABASE_INVALID_SCHEMA_CONFIG';
    throw error;
  }
}

/** Crea el cliente de forma lazy: importar este módulo no abre conexión ni crea usuario. */
export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      validateConfiguration();
      const supabaseModule = await import('@supabase/supabase-js');
      const createClient = Reflect.get(supabaseModule, 'createClient');
      if (typeof createClient !== 'function') throw new Error('El SDK de Supabase no exportó createClient.');
      return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      });
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/** Recupera la sesión persistida o crea una sesión anónima una sola vez. */
export async function ensureAnonymousSession() {
  const client = await getSupabaseClient();
  const { data: existing, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (existing?.session?.user?.id) return existing.session;

  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  if (!data?.session?.user?.id) throw new Error('Supabase no devolvió una sesión anónima válida.');
  return data.session;
}

function profileColumns() {
  return [SUPABASE_PLAYER_ID_COLUMN, SUPABASE_PLAYER_NAME_COLUMN, SUPABASE_PLAYER_AVATAR_COLUMN].join(',');
}
function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row[SUPABASE_PLAYER_ID_COLUMN],
    name: row[SUPABASE_PLAYER_NAME_COLUMN],
    avatar: Number(row[SUPABASE_PLAYER_AVATAR_COLUMN]),
  };
}

/** Lee únicamente el perfil correspondiente a auth.uid(). El trigger debe crear la fila. */
export async function getPlayerProfile() {
  const client = await getSupabaseClient();
  const session = await ensureAnonymousSession();
  const userId = session.user.id;
  const { data, error } = await client
    .from(SUPABASE_PLAYERS_TABLE)
    .select(profileColumns())
    .eq(SUPABASE_PLAYER_ID_COLUMN, userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const missing = new Error('No se encontró el perfil de Supabase. Revisá que el trigger haya creado public.players para auth.uid().');
    missing.code = 'SUPABASE_PROFILE_NOT_FOUND';
    throw missing;
  }
  return normalizeProfile(data);
}

/**
 * Actualiza solo nombre y avatar del usuario actual. El filtro por ID es defensa adicional;
 * la autorización real debe estar en RLS y en los permisos de columnas de Postgres.
 */
export async function updatePlayerProfile({ name, avatar }) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const nameLength = Array.from(cleanName).length;
  const avatarIndex = Number(avatar);
  if (nameLength < 1 || nameLength > 16) throw new RangeError('El apodo debe tener entre 1 y 16 caracteres.');
  if (!Number.isInteger(avatarIndex) || avatarIndex < 0 || avatarIndex > SUPABASE_MAX_AVATAR_INDEX) {
    throw new RangeError(`El avatar debe ser un índice entero entre 0 y ${SUPABASE_MAX_AVATAR_INDEX}.`);
  }

  const client = await getSupabaseClient();
  const session = await ensureAnonymousSession();
  const userId = session.user.id;
  const changes = {
    [SUPABASE_PLAYER_NAME_COLUMN]: cleanName,
    [SUPABASE_PLAYER_AVATAR_COLUMN]: avatarIndex,
  };
  const { data, error } = await client
    .from(SUPABASE_PLAYERS_TABLE)
    .update(changes)
    .eq(SUPABASE_PLAYER_ID_COLUMN, userId)
    .select(profileColumns())
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const denied = new Error('No se actualizó el perfil. No existe una fila propia o la política RLS denegó la operación.');
    denied.code = 'SUPABASE_PROFILE_UPDATE_DENIED';
    throw denied;
  }
  return normalizeProfile(data);
}
