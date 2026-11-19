/* Potential Damage leaderboard — Cloudflare Worker (module syntax).
   The build script prepends engine.js and abilities.js, so globalThis.Potenshall is the exact
   same draft + damage engine the game runs. Scores are never trusted from the browser:
   the Worker replays the draft from its seed and re-runs the fight itself.

   Binding: DB (D1 database). The seed-signing secret is generated on first use and kept in D1.
   Optional secret: TURNSTILE_SECRET turns on the Cloudflare Turnstile bot check for score submissions. */

const SITE = 'https://nicksshoe.github.io';
// The site is moving to potentialdamage.gg; the github.io address stays allowed (it redirects there once the domain is live).
const ALLOWED_ORIGINS = new Set([SITE, 'https://potentialdamage.gg', 'https://www.potentialdamage.gg', 'http://localhost:5173', 'http://localhost:5174']);
const NAME_RE = /^[A-Za-z0-9 _.\-]{1,16}$/;
const CLIENT_RE = /^[A-Za-z0-9-]{8,64}$/;
// ---------- Display-name filter: slurs, hate, harassment, sexual content, impersonation ----------
// A name is normalized before checking, so spacing, punctuation, digit swaps (n1gg3r) and repeated letters (niiigger)
// don't get around it. Each pattern is checked against the squashed name both as-is and with repeated letters
// collapsed, so patterns are written in either form ('niger' catches 'nigger', 'kkk' catches 'kkk').
// Ordinary words that contain a blocked string are blanked out first (grape, therapist, raccoon, Pakistan...).
// Names on the boards go through the same check when read, so adding a word here also hides older names.
const NAME_ALLOW = ['scunthorpe', 'grape', 'drape', 'scrape', 'trapeze', 'parapet', 'therapist', 'raccoon', 'racoon', 'cocoon',
  'tycoon', 'pakistan', 'nigeria', 'montenegro', 'torpedo', 'speedo', 'pedometer', 'shiitake', 'cockpit', 'peacock', 'hancock', 'badminton', 'skys', 'ofage'];
const NAME_SUBSTR = new RegExp('(' + [
  // racial and ethnic slurs
  'niger', 'niga', 'nigr', 'nigz', 'niba', 'niker', 'neger', 'negro', 'chink', 'gook', 'kike', 'wetback', 'beaner', 'paki',
  'raghead', 'towelhead', 'sandniger', 'porchmonkey', 'junglebunny', 'jigabo', 'tarbaby', 'goliwog', 'ziperhead', 'kafir', 'dindu', 'coon',
  // anti-LGBT and disability slurs
  'fag', 'trany', 'shemale', 'retard', 'pidor', 'pidar', 'pidr', 'maricon', 'viado', 'fliker', 'schwuchtel', 'encule',
  // hate groups and extremism
  'nazi', 'hitler', 'siegheil', 'kkk', 'kukluxklan', 'whitepower', 'whitepride', 'whitesupremac', 'aryanbrotherhood', 'swastika', 'holocaust',
  // violence, self-harm and sexual abuse
  'kys', 'kilyourself', 'kilurself', 'rape', 'rapist', 'pedo', 'molest', 'incest', 'schoolshoot',
  // profanity and sexual content (English, German, Spanish, Portuguese, French, Dutch, Russian transliterations)
  'fuck', 'fck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'pusy', 'porn', 'penis', 'vagina',
  'hurensohn', 'fotze', 'pendejo', 'caralho', 'buceta', 'putain', 'salope', 'kanker', 'blyat', 'cyka',
  // impersonating staff or Riot
  'admin', 'moderator', 'riotgames',
].join('|') + ')');
// Short words that are only a problem on their own (spic vs spicy, puta vs reputation, Dyke vs Van Dyke...).
const NAME_WORDS = new Set(['spic', 'spics', 'dyke', 'dykes', 'heil', 'klan', 'puta', 'puto', 'hoer', 'kut', 'suka', 'pede', 'lynch', 'isis']);
// Calls to violence against a group: "kill all the jews", "gas the ...", "hate blacks".
const NAME_THREAT = /(kil+|hate|gas|lynch|hang|burn)(al+)?(the)?(jew|black|gay|muslim|white|asian|mexican|arab|tran|indian|chinese|latin|nig)/;
const LEET = [{ 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g' }, { 1: 'l' }];
function nameBlocked(name) {
  const lower = String(name || '').toLowerCase();
  if (/14\W*88/.test(lower)) return true;                                        // neo-Nazi number code
  for (const map of LEET) {
    const leet = lower.replace(/[0-9]/g, d => map[d] || LEET[0][d] || d);
    const words = leet.split(/[^a-z]+/).filter(Boolean);
    let sq = words.join('');
    for (const a of NAME_ALLOW) sq = sq.split(a).join('-');
    const col = sq.replace(/([a-z])\1+/g, '$1');
    if (NAME_SUBSTR.test(sq) || NAME_SUBSTR.test(col) || NAME_THREAT.test(sq) || NAME_THREAT.test(col)) return true;
    const squashed = words.join(''), squashedCol = squashed.replace(/([a-z])\1+/g, '$1');
    if (NAME_WORDS.has(squashed) || NAME_WORDS.has(squashedCol)) return true;
    if (words.some(w => NAME_WORDS.has(w) || NAME_WORDS.has(w.replace(/([a-z])\1+/g, '$1')))) return true;
  }
  return false;
}
const shownName = n => nameBlocked(n) ? 'Player' : n;

const PE = () => globalThis.Potenshall;
// Ability data comes from the site's kits/ folder (same files the players' browsers use), else CommunityDragon.
if (globalThis.Potenshall && globalThis.Potenshall.Abilities) globalThis.Potenshall.Abilities.setKitBase(`${SITE}/kits`);
let dataCache = null, stacksCache = null;

async function getData() {
  if (!dataCache || Date.now() - dataCache.at > 10 * 60 * 1000) dataCache = { ...(await PE().loadPatchData()), at: Date.now() };
  return dataCache;
}
async function getStacks() {
  if (!stacksCache || Date.now() - stacksCache.at > 10 * 60 * 1000) {
    const r = await fetch(`${SITE}/stacks.json`, { cf: { cacheTtl: 600 } }).catch(() => null);
    stacksCache = { value: r && r.ok ? await r.json() : null, at: Date.now() };
  }
  return stacksCache.value;
}
let secretCache = null;
async function getSecret(env) {
  if (secretCache) return secretCache;
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'seed_secret'").first();
  if (row) return (secretCache = row.value);
  const fresh = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('seed_secret', ?)").bind(fresh).run();
  const again = await env.DB.prepare("SELECT value FROM config WHERE key = 'seed_secret'").first();
  return (secretCache = again.value);
}
const shortPatch = p => p.split('.').slice(0, 2).join('.');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}
function cors(origin) {
  return ALLOWED_ORIGINS.has(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' }
    : {};
}
const fail = (msg, status, origin) => json({ error: msg }, status, origin);

// ---------- Rate limits (per visitor, fixed windows) ----------
// The visitor's IP is never stored: only an HMAC of it (keyed with the server secret, mixed with the route and the
// time window), kept until the window ends and then deleted by the cleanup below.
const LIMITS = { start: [[60, 12], [3600, 120]], submit: [[60, 6], [3600, 40]] }; // [window seconds, max requests]
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)').run();
  schemaReady = true;
}
async function rateLimited(req, env, route) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  for (const [win, max] of LIMITS[route]) {
    const slot = Math.floor(now / win);
    const k = (await hmac(await getSecret(env), `${ip}|${route}|${win}|${slot}`)).slice(0, 32);
    const row = await env.DB.prepare('INSERT INTO rate (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n')
      .bind(k, (slot + 1) * win).first();
    if (row && row.n > max) return true;
  }
  return false;
}

// ---------- Data retention ----------
// At most once an hour (piggybacking on a request): used Free Play tickets older than 2 days and expired rate-limit
// counters are deleted; scores older than 90 days are deleted unless they are that player's best or lowest ever
// (those stay on the All-time boards until the player asks for removal).
let cleanupCheckedAt = 0;
async function maybeCleanup(env) {
  const now = Date.now();
  if (now - cleanupCheckedAt < 10 * 60 * 1000) return; // skip the database lookup on most requests
  cleanupCheckedAt = now;
  const last = await env.DB.prepare("SELECT value FROM config WHERE key = 'last_cleanup'").first();
  if (last && now - Number(last.value) < 3600 * 1000) return;
  await env.DB.prepare("INSERT INTO config (key, value) VALUES ('last_cleanup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(now)).run();
  const iso = days => new Date(now - days * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tickets WHERE used < ?').bind(iso(2)),
    env.DB.prepare('DELETE FROM rate WHERE exp < ?').bind(Math.floor(now / 1000)),
    env.DB.prepare(`DELETE FROM scores WHERE created < ? AND id NOT IN (
        SELECT id FROM scores s WHERE score = (SELECT MAX(score) FROM scores WHERE client = s.client)
                                   OR score = (SELECT MIN(score) FROM scores WHERE client = s.client))`).bind(iso(90)),
  ]);
}

// ---------- Optional bot check (Cloudflare Turnstile) ----------
// Off until a TURNSTILE_SECRET secret is added to the Worker (and the matching site key to the page).
async function turnstileOk(env, token, req) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token || typeof token !== 'string') return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET); form.append('response', token);
  const ip = req.headers.get('CF-Connecting-IP'); if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then(x => x.json()).catch(() => null);
  return !!(r && r.success);
}

// ---------- Routes ----------
async function start(req, env, origin) {
  const { patch } = await req.json().catch(() => ({}));
  const data = await getData();
  if (patch !== data.patch) return fail('A new patch is out. Reload the page.', 409, origin);
  const seed = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
  return json({ seed, patch, sig: await hmac(await getSecret(env), `${seed}|${patch}`) }, 200, origin);
}

async function submit(req, env, origin) {
  const body = await req.json().catch(() => null);
  if (!body) return fail('Bad request', 400, origin);
  const { mode, patch, date, ticket, log, name, client, captcha } = body;
  if (!NAME_RE.test(name || '') || nameBlocked(name)) return fail('Please choose a different name.', 400, origin);
  if (!CLIENT_RE.test(client || '')) return fail('Bad request', 400, origin);
  if (!(await turnstileOk(env, captcha, req))) return fail('Please complete the check and try again.', 403, origin);

  const data = await getData();
  if (patch !== data.patch) return fail('A new patch is out. Reload the page and play again.', 409, origin);

  let seed, period;
  if (mode === 'daily') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return fail('Bad date', 400, origin);
    const diffDays = Math.abs(Date.parse(date + 'T12:00:00Z') - Date.now()) / 86400000;
    if (!(diffDays <= 1.6)) return fail("That daily isn't open anymore.", 400, origin); // allows every time zone
    seed = `${patch}|${date}`; period = date;
  } else if (mode === 'free') {
    if (!ticket || typeof ticket.seed !== 'string' || ticket.patch !== patch) return fail('This run can\'t be verified.', 400, origin);
    if ((await hmac(await getSecret(env), `${ticket.seed}|${ticket.patch}`)) !== ticket.sig) return fail('This run can\'t be verified.', 400, origin);
    seed = `free|${ticket.seed}`; period = shortPatch(patch);
  } else return fail('Bad mode', 400, origin);

  let draft;
  try { draft = PE().replayDraft(data, seed, log); }
  catch (e) { return fail('That draft doesn\'t match the offers for this run.', 400, origin); }

  const champ = draft.champ;
  let kitInfo = {};
  try {
    const kit = await PE().Abilities.loadKit(champ.id);
    kitInfo = { kit, spells: PE().Abilities.describeKit(kit, champ.info.magic > champ.info.attack ? 'magic' : 'physical') };
  } catch { /* falls back to the estimated kit, same as the game */ }
  const stacks = await getStacks();
  const score = Math.round(PE().simulate(champ, draft.items, { ...kitInfo, stacks: stacks && stacks.champions }).total);

  if (mode === 'free') {
    const used = await env.DB.prepare('INSERT OR IGNORE INTO tickets (seed, used) VALUES (?, ?)').bind(ticket.seed, new Date().toISOString()).run();
    if (!used.meta.changes) return fail('This run was already submitted.', 409, origin);
  }
  const ins = await env.DB.prepare(
    'INSERT OR IGNORE INTO scores (mode, period, client, name, champ, items, score, created, patch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(mode, period, client, name.trim(), champ.id, draft.items.map(i => i.id).join(','), score, new Date().toISOString(), shortPatch(patch)).run();
  if (!ins.meta.changes) return fail("You've already submitted today's daily.", 409, origin);

  const better = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM (SELECT client, MAX(score) AS m FROM scores WHERE mode = ? AND period = ? GROUP BY client) WHERE m > ?'
  ).bind(mode, period, score).first();
  // Reverse board: each player's lowest score; rank 1 = least damage.
  const lower = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM (SELECT client, MIN(score) AS m FROM scores WHERE mode = ? AND period = ? GROUP BY client) WHERE m < ?'
  ).bind(mode, period, score).first();
  const total = await env.DB.prepare('SELECT COUNT(DISTINCT client) AS n FROM scores WHERE mode = ? AND period = ?').bind(mode, period).first();
  return json({ score, rank: better.n + 1, lowRank: lower.n + 1, of: total.n, period }, 200, origin);
}

async function board(url, env, origin) {
  const mode = url.searchParams.get('mode'), period = url.searchParams.get('period') || '', me = url.searchParams.get('client') || '';
  const low = url.searchParams.get('order') === 'low'; // least-damage board: each player's lowest score, ascending
  if (mode === 'all') return allTime(env, origin, me, low);
  if (!['daily', 'free'].includes(mode) || !/^[\d.\-]{3,12}$/.test(period)) return fail('Bad request', 400, origin);
  const { results } = await env.DB.prepare(
    `SELECT name, champ, items, score, client FROM scores s
     WHERE mode = ?1 AND period = ?2 AND score = (SELECT ${low ? 'MIN' : 'MAX'}(score) FROM scores WHERE mode = ?1 AND period = ?2 AND client = s.client)
     GROUP BY client ORDER BY score ${low ? 'ASC' : 'DESC'} LIMIT 50`
  ).bind(mode, period).all();
  // Never expose other players' client ids; just flag the caller's own row.
  const rows = results.map(r => ({ name: shownName(r.name), champ: r.champ, items: r.items, score: r.score, mine: !!me && r.client === me }));
  return new Response(JSON.stringify({ rows }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15', ...cors(origin) } });
}

// All-time board: each player's best (or lowest) score ever, across Daily and Free Play, with the patch it was set on.
async function allTime(env, origin, me, low) {
  const { results } = await env.DB.prepare(
    `SELECT name, champ, items, score, client, mode, period, patch FROM scores s
     WHERE score = (SELECT ${low ? 'MIN' : 'MAX'}(score) FROM scores WHERE client = s.client)
     GROUP BY client ORDER BY score ${low ? 'ASC' : 'DESC'} LIMIT 50`
  ).all();
  // date: the day of a Daily score, so the page can hide today's Daily builds from players who haven't played it yet.
  const rows = results.map(r => ({ name: shownName(r.name), champ: r.champ, items: r.items, score: r.score, mode: r.mode,
    date: r.mode === 'daily' ? r.period : '', patch: r.patch || (r.mode === 'free' ? r.period : ''), mine: !!me && r.client === me }));
  return new Response(JSON.stringify({ rows }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15', ...cors(origin) } });
}

// Patches that have Free Play scores, newest first (for the past-patch picker).
async function periods(url, env, origin) {
  const { results } = await env.DB.prepare("SELECT DISTINCT period FROM scores WHERE mode = 'free'").all();
  const list = results.map(r => r.period).sort((a, b) => b.split('.').map(Number).reduce((x, v, i) => x || v - (+a.split('.')[i] || 0), 0));
  return json({ periods: list }, 200, origin);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    try {
      await ensureSchema(env);
      if (ctx && ctx.waitUntil) ctx.waitUntil(maybeCleanup(env).catch(() => {}));
      const route = req.method === 'POST' && { '/start': 'start', '/submit': 'submit' }[url.pathname];
      if (route && await rateLimited(req, env, route)) return fail('Too many requests. Wait a minute and try again.', 429, origin);
      if (route === 'start') return await start(req, env, origin);
      if (route === 'submit') return await submit(req, env, origin);
      if (req.method === 'GET' && url.pathname === '/board') return await board(url, env, origin);
      if (req.method === 'GET' && url.pathname === '/periods') return await periods(url, env, origin);
      if (url.pathname === '/') return json({ ok: true, service: 'Potential Damage leaderboard' }, 200, origin);
      return fail('Not found', 404, origin);
    } catch (e) {
      return fail('Server error', 500, origin);
    }
  },
};
