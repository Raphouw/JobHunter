import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://seacseklrbucmgxaykgc.supabase.co';
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_wQCX6LA7JVPRaL5cE-Lfsw_oUxISayf';
const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.readonly',
];

function config() {
  const origin = (process.env.PUBLIC_APP_URL || 'https://job-hunter-three-chi.vercel.app').replace(/\/$/, '');
  const key = Buffer.from(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || '', 'base64');
  return {
    origin, key,
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    ready: key.length === 32 && !!(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID)
      && !!(process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET)
      && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function redirectUri(settings) { return `${settings.origin}/api/google?action=callback`; }
function signState(data, key) {
  const payload = base64url(JSON.stringify(data));
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function readState(state, key) {
  const [payload, signature, extra] = String(state || '').split('.');
  if (!payload || !signature || extra) throw new Error('État OAuth invalide');
  const expected = createHmac('sha256', key).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('État OAuth invalide');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data.userId || !data.expires || data.expires < Date.now()) throw new Error('Connexion expirée');
  return data;
}
function encrypt(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}
function decrypt(value, key) {
  const [iv, tag, body] = String(value).split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !body) throw new Error('Jeton Google invalide');
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8');
}

async function googleAccess(userId, settings) {
  const rows = await database(`hunter_google_connections?user_id=eq.${encodeURIComponent(userId)}&select=encrypted_refresh_token`, settings);
  if (!rows?.length) throw new Error('Compte Google non connecté');
  const refresh = decrypt(rows[0].encrypted_refresh_token, settings.key);
  const result = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret,
      refresh_token: refresh, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new Error(`Renouvellement Google HTTP ${result.status}`);
  const tokens = await result.json();
  if (!tokens.access_token) throw new Error('Jeton Google absent');
  return tokens.access_token;
}

async function googleApi(path, token, options = {}) {
  const result = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!result.ok) throw new Error(`Google Sheets HTTP ${result.status}`);
  return result.status === 204 ? null : result.json();
}

async function ownedProfile(userId, profileId, settings) {
  if (!/^[0-9a-f-]{36}$/i.test(String(profileId))) throw new Error('Profil invalide');
  const rows = await database(`hunter_profiles?id=eq.${encodeURIComponent(profileId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,name,config`, settings);
  if (!rows?.length) throw new Error('Profil introuvable');
  return rows[0];
}

async function authenticatedUser(request) {
  const token = /^Bearer (.+)$/i.exec(request.headers.authorization || '')?.[1];
  if (!token) return null;
  const result = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  return result.ok ? await result.json() : null;
}

async function database(path, settings, options = {}) {
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: settings.serviceKey,
      Authorization: `Bearer ${settings.serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!result.ok) throw new Error(`Supabase HTTP ${result.status}`);
  return result.status === 204 ? null : result.json();
}

export default async function handler(request, response) {
  const settings = config();
  const action = new URL(request.url, settings.origin).searchParams.get('action') || 'status';
  if (!settings.ready) {
    return response.status(503).json({ configured: false, connected: false,
      error: 'Connexion Google à configurer dans Vercel.' });
  }

  try {
    if (action === 'callback' && request.method === 'GET') {
      const params = new URL(request.url, settings.origin).searchParams;
      if (params.has('error')) return response.redirect(302, `${settings.origin}/?google=denied`);
      const state = readState(params.get('state'), settings.key);
      const code = params.get('code');
      if (!code) throw new Error('Code OAuth absent');
      const exchange = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: settings.clientId,
          client_secret: settings.clientSecret, redirect_uri: redirectUri(settings), grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(15000),
      });
      if (!exchange.ok) throw new Error(`Google OAuth HTTP ${exchange.status}`);
      const tokens = await exchange.json();
      if (!tokens.refresh_token || !tokens.access_token) throw new Error('Jeton de renouvellement absent');
      const identity = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000),
      });
      if (!identity.ok) throw new Error('Identité Google indisponible');
      const googleUser = await identity.json();
      if (!googleUser.sub || !googleUser.email) throw new Error('Identité Google incomplète');
      await database('hunter_google_connections?on_conflict=user_id', settings, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: state.userId, google_subject: googleUser.sub,
          google_email: googleUser.email, encrypted_refresh_token: encrypt(tokens.refresh_token, settings.key),
          granted_scopes: String(tokens.scope || '').split(' ').filter(Boolean),
          connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      return response.redirect(302, `${settings.origin}/?google=connected`);
    }

    const user = await authenticatedUser(request);
    if (!user?.id) return response.status(401).json({ error: 'Session expirée. Reconnecte-toi.' });
    if (action === 'status' && request.method === 'GET') {
      const rows = await database(`hunter_google_connections?user_id=eq.${encodeURIComponent(user.id)}&select=google_email,granted_scopes,connected_at`, settings);
      return response.status(200).json({ configured: true, connected: !!rows?.length,
        email: rows?.[0]?.google_email || null, scopes: rows?.[0]?.granted_scopes || [],
        connectedAt: rows?.[0]?.connected_at || null });
    }
    if (action === 'start' && request.method === 'POST') {
      const state = signState({ userId: user.id, expires: Date.now() + 10 * 60_000,
        nonce: randomBytes(16).toString('hex') }, settings.key);
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: redirectUri(settings),
        response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline',
        prompt: 'consent', include_granted_scopes: 'true', state }).toString();
      return response.status(200).json({ url: url.toString() });
    }
    if (action === 'disconnect' && request.method === 'POST') {
      await database(`hunter_google_connections?user_id=eq.${encodeURIComponent(user.id)}`, settings,
        { method: 'DELETE' });
      return response.status(200).json({ connected: false });
    }
    if (action === 'scan-gmail' && request.method === 'POST') {
      const token = await googleAccess(user.id, settings);
      const candidatures = Array.isArray(request.body?.candidatures) ? request.body.candidatures : [];
      const query = String(request.body?.query || 'candidature OR stage OR entretien OR intern OR interview OR recrutement').slice(0, 200);

      // Search recent messages in Gmail
      const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=35`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });

      if (!listRes.ok) {
        throw new Error(`Gmail API HTTP ${listRes.status}`);
      }

      const listData = await listRes.json();
      const messageItems = listData.messages || [];

      // Fetch metadata & snippet for the first 25 messages
      const details = await Promise.all(
        messageItems.slice(0, 25).map(async (m) => {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(8000),
              }
            );
            if (!msgRes.ok) return null;
            const msgJson = await msgRes.json();
            const headers = msgJson.payload?.headers || [];
            const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || '';
            const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value || '';
            const date = headers.find((h) => h.name.toLowerCase() === 'date')?.value || '';
            return {
              id: m.id,
              threadId: m.threadId,
              snippet: msgJson.snippet || '',
              subject,
              from,
              date,
            };
          } catch {
            return null;
          }
        })
      );

      const validDetails = details.filter(Boolean);

      // Match against user candidatures
      const detectedUpdates = [];
      validDetails.forEach((msg) => {
        const fullText = `${msg.subject} ${msg.from} ${msg.snippet}`.toLowerCase();

        for (const cand of candidatures) {
          const companyName = String(cand.company || '').toLowerCase().trim();
          if (!companyName || companyName.length < 3) continue;

          if (fullText.includes(companyName)) {
            let detectedStatus = 'Réponse obtenue';
            let confidence = 0.8;
            if (/entretien|interview|invitation|disponibilit|teams|zoom|meet|call|change/i.test(fullText)) {
              detectedStatus = 'Entretien';
              confidence = 0.95;
            } else if (/malheureusement|regret|ne pouvons pas donner suite|autre candidat|pas retenu|refus|non retenu|dclin/i.test(fullText)) {
              detectedStatus = 'Refusé';
              confidence = 0.95;
            } else if (/accept|retenu|flicitation|offre/i.test(fullText)) {
              detectedStatus = 'Validé';
              confidence = 0.9;
            }

            detectedUpdates.push({
              candidatureId: cand.id,
              company: cand.company,
              currentStatus: cand.status || 'Demande initiale',
              detectedStatus,
              confidence,
              emailSubject: msg.subject,
              emailFrom: msg.from,
              emailDate: msg.date,
              snippet: msg.snippet,
              messageId: msg.id,
            });
            break;
          }
        }
      });

      return response.status(200).json({
        scannedCount: validDetails.length,
        updates: detectedUpdates,
        recentEmails: validDetails.slice(0, 10),
      });
    }

    if (['create-sheet', 'sync-sheet', 'pull-sheet'].includes(action) && request.method === 'POST') {
      const profile = await ownedProfile(user.id, request.body?.profileId, settings);
      const token = await googleAccess(user.id, settings);
      const google = profile.config?.integrations?.google || {};
      let sheetId = String(google.sheet_id || '').trim();
      if (action === 'create-sheet') {
        const created = await googleApi('spreadsheets', token, { method: 'POST',
          body: JSON.stringify({ properties: { title: `Stage Hunter — ${profile.name}` } }) });
        sheetId = created.spreadsheetId;
        const config = { ...profile.config, integrations: { ...profile.config?.integrations,
          google: { ...google, sheet_id: sheetId, sheets_enabled: true } } };
        await database(`hunter_profiles?id=eq.${encodeURIComponent(profile.id)}&user_id=eq.${encodeURIComponent(user.id)}`,
          settings, { method: 'PATCH', body: JSON.stringify({ config }) });
        return response.status(200).json({ sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}` });
      }
      const match = /\/spreadsheets\/d\/([\w-]+)/.exec(sheetId);
      if (match) sheetId = match[1];
      if (!/^[\w-]{20,}$/.test(sheetId)) return response.status(400).json({ error: 'Crée un Sheet ou indique son identifiant dans le profil.' });
      
      const tabOpp = String(google.opportunity_tab || 'Opportunités').slice(0, 90);
      const tabCand = String(google.candidature_tab || 'Réponses au formulaire 1').slice(0, 90);
      const sheet = await googleApi(`spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties.title`, token);
      const existingTitles = (sheet.sheets || []).map((s) => s.properties?.title);

      // Ensure both tabs exist
      const toAdd = [];
      if (!existingTitles.includes(tabOpp)) toAdd.push({ addSheet: { properties: { title: tabOpp } } });
      if (!existingTitles.includes(tabCand)) toAdd.push({ addSheet: { properties: { title: tabCand } } });
      if (toAdd.length > 0) {
        await googleApi(`spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`, token, { method: 'POST',
          body: JSON.stringify({ requests: toAdd }) });
      }

      if (action === 'pull-sheet') {
        // Read candidatures from Sheet
        let candidatures = [];
        try {
          const rangeCand = `'${tabCand.replaceAll("'", "''")}'!A1:Z`;
          const candData = await googleApi(`spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(rangeCand)}`, token);
          const rows = candData.values || [];
          if (rows.length >= 2) {
            const headerRow = rows[0].map((c) => String(c).toLowerCase().trim());
            const col = (names) => headerRow.findIndex((h) => names.some((n) => h.includes(n)));
            const cDate = col(['horodateur', 'date']);
            const cCanton = col(['canton']);
            const cComp = col(['nom entreprise', 'entreprise']);
            const cCity = col(['ville']);
            const cSec = col(['secteur']);
            const cAct = col(['activit', 'détaill']);
            const cL1 = col(['lien 1']);
            const cL2 = col(['lien 2']);
            const cL3 = col(['lien 3']);
            const cDem = col(['démarche', 'demarche']);
            const cNote = col(['note']);
            const cStat = col(['statut actuel', 'statut']);
            const cMail = col(['email', 'mail']);
            const cRet = col(['retour', 'retours', 'memo']);

            for (let i = 1; i < rows.length; i++) {
              const r = rows[i];
              const comp = r[cComp]?.trim();
              if (!comp) continue;
              const retoursStr = (cRet >= 0 ? r[cRet] : '') || '';
              const notes = [];
              const statusHistory = [];
              retoursStr.split('||').map((p) => p.trim()).filter(Boolean).forEach((part) => {
                if (part.includes('Statut passé à :') || part.includes('🔄')) {
                  statusHistory.push({ text: part, date: part.slice(1, 17) });
                } else {
                  notes.push({ text: part, date: part.slice(1, 17) });
                }
              });

              candidatures.push({
                company: comp,
                canton: (cCanton >= 0 ? r[cCanton] : '') || '',
                location: (cCity >= 0 ? r[cCity] : '') || '',
                sector: (cSec >= 0 ? r[cSec] : '') || '',
                detailed_activity: (cAct >= 0 ? r[cAct] : '') || '',
                link1: (cL1 >= 0 ? r[cL1] : '') || '',
                link2: (cL2 >= 0 ? r[cL2] : '') || '',
                link3: (cL3 >= 0 ? r[cL3] : '') || '',
                demarche: (cDem >= 0 ? r[cDem] : '') || '',
                rating: Number(cNote >= 0 ? r[cNote] : 0) || 0,
                status: (cStat >= 0 ? r[cStat] : 'Demande initiale') || 'Demande initiale',
                contact_email: (cMail >= 0 ? r[cMail] : '') || '',
                notes,
                status_history: statusHistory,
                created_at: (cDate >= 0 ? r[cDate] : null) || new Date().toISOString(),
              });
            }
          }
        } catch (pullErr) {
          console.warn('Error reading candidatures tab:', pullErr.message);
        }

        return response.status(200).json({
          sheetId,
          candidatures,
          url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
        });
      }

      // Sync both tabs:
      // Tab 1: Opportunités
      const offers = await database(`hunter_offers?profile_id=eq.${encodeURIComponent(profile.id)}&user_id=eq.${encodeURIComponent(user.id)}&review_decision=eq.keep&select=id,score,confidence,company,title,location,canton,language,duration,start_date,domain_category,skills_found,reasons,source,url,discovered_at&order=score.desc&limit=1000`, settings);
      const valuesOpp = [['Action', 'Score /100', 'Confiance', 'Entreprise', 'Offre', 'Ville / lieu', 'Canton', 'Langue', 'Durée', 'Début', 'Domaine', 'Compétences détectées', 'Pourquoi', 'Source', 'Lien', 'Date découverte', 'ID Stage Hunter'],
        ...offers.map((item) => ['GARDER', item.score, item.confidence, item.company, item.title, item.location,
          item.canton, item.language, item.duration, item.start_date, item.domain_category,
          item.skills_found, item.reasons, item.source, item.url, item.discovered_at, item.id])];
      const rangeOpp = `'${tabOpp.replaceAll("'", "''")}'!A1:Q`;
      await googleApi(`spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(rangeOpp)}:clear`, token,
        { method: 'POST', body: '{}' });
      await googleApi(`spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(rangeOpp)}?valueInputOption=RAW`, token,
        { method: 'PUT', body: JSON.stringify({ values: valuesOpp }) });

      // Tab 2: Réponses au formulaire 1 (Candidatures)
      const candRows = request.body?.candidatures || [];
      if (candRows.length > 0) {
        const candHeaders = ['Horodateur', 'Cantons', 'Nom Entreprise', "Ville de l'Entreprise", "Secteur d'activité", 'Activité détaillée', 'Lien 1', 'Lien 2', 'Lien 3', 'Démarches', 'Note /10', 'Statut actuel', 'email', 'Retours'];
        const valuesCand = [candHeaders, ...candRows.map((c) => {
          const retoursParts = [];
          (c.status_history || []).forEach((sh) => { if (sh.text) retoursParts.push(sh.text); });
          (c.notes || []).forEach((n) => { if (n.text) retoursParts.push(n.text); });
          return [
            c.created_at || '',
            c.canton || '',
            c.company || '',
            c.location || '',
            c.sector || '',
            c.detailed_activity || '',
            c.link1 || '',
            c.link2 || '',
            c.link3 || '',
            c.demarche || '',
            c.rating || '',
            c.status || 'Demande initiale',
            c.contact_email || '',
            retoursParts.join(' || ')
          ];
        })];
        const rangeCand = `'${tabCand.replaceAll("'", "''")}'!A1:N`;
        await googleApi(`spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(rangeCand)}:clear`, token,
          { method: 'POST', body: '{}' });
        await googleApi(`spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(rangeCand)}?valueInputOption=RAW`, token,
          { method: 'PUT', body: JSON.stringify({ values: valuesCand }) });
      }

      return response.status(200).json({ exported: offers.length, candidatures: candRows.length, sheetId,
        url: `https://docs.google.com/spreadsheets/d/${sheetId}` });
    }
    return response.status(405).json({ error: 'Action non prise en charge.' });
  } catch (error) {
    console.error('Google connection:', error.message);
    if (action === 'callback') return response.redirect(302, `${settings.origin}/?google=error`);
    return response.status(502).json({ error: 'Connexion Google indisponible. Réessaie plus tard.' });
  }
}
