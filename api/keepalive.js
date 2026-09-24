// Vercel Cron calls this read-only endpoint once a day. The publishable key
// grants access only to the single public heartbeat row, never to user data.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://seacseklrbucmgxaykgc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_wQCX6LA7JVPRaL5cE-Lfsw_oUxISayf';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).end();
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.authorization !== `Bearer ${secret}`) {
    return response.status(401).end();
  }

  const endpoint = `${SUPABASE_URL}/rest/v1/hunter_service_heartbeat?select=id&limit=1`;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await fetch(endpoint, {
        method: 'GET',
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new Error(`Supabase returned HTTP ${result.status}`);
      const rows = await result.json();
      if (!Array.isArray(rows) || rows[0]?.id !== 1) throw new Error('Heartbeat row missing');
    }
    return response.status(204).end();
  } catch (error) {
    console.error('Supabase heartbeat failed:', error.message);
    return response.status(502).json({ error: 'Heartbeat failed' });
  }
}
