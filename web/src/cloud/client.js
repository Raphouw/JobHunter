import { createClient } from '@supabase/supabase-js';

const url =
  import.meta.env.VITE_SUPABASE_URL ||
  (import.meta.env.MODE === 'cloud' ? 'https://seacseklrbucmgxaykgc.supabase.co' : '');
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  (import.meta.env.MODE === 'cloud' ? 'sb_publishable_wQCX6LA7JVPRaL5cE-Lfsw_oUxISayf' : '');

export const cloudEnabled = Boolean(url && key);
export const supabase = cloudEnabled
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

export function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}
