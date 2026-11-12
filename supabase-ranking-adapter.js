// Adaptador de solo lectura para rankings Supabase.
// No se importa desde main.js: InstantDB sigue siendo el backend activo hasta el corte autorizado.
import { getSupabaseClient } from './supabase-client.js';
import {
  SUPABASE_PLAYERS_TABLE,
  SUPABASE_PLAYER_ID_COLUMN,
  SUPABASE_PLAYER_NAME_COLUMN,
  SUPABASE_PLAYER_AVATAR_COLUMN,
  SUPABASE_MAX_AVATAR_INDEX,
} from './supabase_config.js';

const SCORES_TABLE = 'scores';
const SCORE_COLUMNS = 'id,player_id,game,score,created_at';
const ALLOWED_GAMES = new Set(['dirigir', 'ritmo', 'sinfonico', 'rosco', 'escape-salieri']);
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 300;
const PLAYER_BATCH_SIZE = 75;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeLimit(value) {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError('El límite del ranking debe ser un entero positivo.');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

/**
 * Lee un ranking por minijuego y devuelve el contrato que puede adaptar la UI actual:
 * { id, playerId, name, game, score, avatar, timestamp }.
 * Solo hace SELECT. El acceso público a scores y a perfiles visibles para rankings debe
 * estar permitido explícitamente por RLS; el import del módulo no abre conexión.
 */
export async function fetchSupabaseRanking({ game, limit = DEFAULT_LIMIT } = {}) {
  if (!ALLOWED_GAMES.has(game)) throw new RangeError('Minijuego no reconocido para el ranking.');
  const safeLimit = normalizeLimit(limit);
  const client = await getSupabaseClient();
  const { data: scoreRows, error: scoresError } = await client
    .from(SCORES_TABLE)
    .select(SCORE_COLUMNS)
    .eq('game', game)
    .order('score', { ascending: false })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(safeLimit);

  if (scoresError) {
    throw codedError('SUPABASE_RANKING_READ_FAILED', 'No se pudo leer el ranking de Supabase. Revisá RLS y permisos de lectura.');
  }

  const validRows = (Array.isArray(scoreRows) ? scoreRows : []).filter((row) => {
    const score = Number(row?.score);
    return row && UUID_PATTERN.test(String(row.id))
      && UUID_PATTERN.test(String(row.player_id))
      && row.game === game
      && Number.isSafeInteger(score) && score >= 0;
  });
  if (!validRows.length) return [];

  const playerIds = [...new Set(validRows.map((row) => row.player_id))];
  const profilesById = new Map();
  for (const batch of chunks(playerIds, PLAYER_BATCH_SIZE)) {
    const { data: profiles, error: playersError } = await client
      .from(SUPABASE_PLAYERS_TABLE)
      .select(`${SUPABASE_PLAYER_ID_COLUMN},${SUPABASE_PLAYER_NAME_COLUMN},${SUPABASE_PLAYER_AVATAR_COLUMN}`)
      .in(SUPABASE_PLAYER_ID_COLUMN, batch);
    if (playersError) {
      throw codedError('SUPABASE_RANKING_PROFILE_READ_FAILED', 'Se leyeron puntajes, pero no se pudieron leer los perfiles públicos necesarios para mostrarlos. Revisá la política de lectura de players.');
    }
    for (const profile of Array.isArray(profiles) ? profiles : []) {
      profilesById.set(profile[SUPABASE_PLAYER_ID_COLUMN], profile);
    }
  }

  return validRows.map((row) => {
    const profile = profilesById.get(row.player_id);
    const rawAvatar = Number(profile?.[SUPABASE_PLAYER_AVATAR_COLUMN]);
    const avatar = Number.isInteger(rawAvatar) && rawAvatar >= 0 && rawAvatar <= SUPABASE_MAX_AVATAR_INDEX ? rawAvatar : 0;
    const createdAt = Date.parse(row.created_at);
    return {
      id: row.id,
      playerId: row.player_id,
      name: typeof profile?.[SUPABASE_PLAYER_NAME_COLUMN] === 'string' && profile[SUPABASE_PLAYER_NAME_COLUMN].trim()
        ? profile[SUPABASE_PLAYER_NAME_COLUMN].trim()
        : 'Músico',
      game: row.game,
      score: Number(row.score),
      avatar,
      timestamp: Number.isFinite(createdAt) ? createdAt : 0,
      profileAvailable: Boolean(profile),
    };
  });
}
