// Configuración pública de Supabase para el cliente del navegador.
// Pegá acá la Project URL y la publishable key de Supabase (no la service_role).
// Estos valores son públicos; la seguridad real depende de RLS y permisos de la base.
export const SUPABASE_URL = 'https://ndceifdvswkazilubiph.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_IoJNt0jKzqXCmO41LNEQvg_VXo-BxAq';

// Defaults asumidos para public.players; ajustar solo si el esquema creado usa otros nombres.
export const SUPABASE_PLAYERS_TABLE = 'players';
export const SUPABASE_PLAYER_ID_COLUMN = 'id';
export const SUPABASE_PLAYER_NAME_COLUMN = 'name';
export const SUPABASE_PLAYER_AVATAR_COLUMN = 'avatar';

// El perfil local del juego limita el índice seleccionable a 0..6.
export const SUPABASE_MAX_AVATAR_INDEX = 6;

// Habilitado solo para la vista previa de desarrollo; el preflight bloquea la prueba
// mientras falten credenciales válidas y también requiere confirmar que sea staging.
export const SUPABASE_DEV_TEST_ENABLED = false;