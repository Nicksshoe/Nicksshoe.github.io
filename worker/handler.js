/* Potenshall Damage leaderboard — Cloudflare Worker (module syntax).
   The build script prepends engine.js and abilities.js, so globalThis.Potenshall is the exact
   same draft + damage engine the game runs. Scores are never trusted from the browser:
   the Worker replays the draft from its seed and re-runs the fight itself.

   Bindings: DB (D1 database), SEED_SECRET (secret text). */

const SITE = 'https://nicksshoe.github.io';
const ALLOWED_ORIGINS = new Set([SITE, 'https://potenshalldamage.io', 'http://localhost:5173', 'http://localhost:5174']);
const NAME_RE = /^[A-Za-z0-9 _.\-]{1,16}$/;
const CLIENT_RE = /^[A-Za-z0-9-]{8,64}$/;
// Small blocklist for display names; substrings, case-insensitive.
const BLOCKED = /(fuck|shit|cunt|nigg|fag|retard|bitch|whore|slut|rape|nazi|hitler|kys)/i;

const PE = () => globalThis.Potenshall;
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

// ---------- Routes ----------
async function start(req, env, origin) {
  const { patch } = await req.json().catch(() => ({}));
  const data = await getData();
  if (patch !== data.patch) return fail('A new patch is out. Reload the page.', 409, origin);
  const seed = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
  return json({ seed, patch, sig: await hmac(env.SEED_SECRET, `${seed}|${patch}`) }, 200, origin);
}

async function submit(req, env, origin) {
  const body = await req.json().catch(() => null);
  if (!body) return fail('Bad request', 400, origin);
  const { mode, patch, date, ticket, log, name, client } = body;
  if (!NAME_RE.test(name || '') || BLOCKED.test(name)) return fail('Please choose a different name.', 400, origin);
  if (!CLIENT_RE.test(client || '')) return fail('Bad request', 400, origin);

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
    if ((await hmac(env.SEED_SECRET, `${ticket.seed}|${ticket.patch}`)) !== ticket.sig) return fail('This run can\'t be verified.', 400, origin);
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
    'INSERT OR IGNORE INTO scores (mode, period, client, name, champ, items, score, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(mode, period, client, name.trim(), champ.id, draft.items.map(i => i.id).join(','), score, new Date().toISOString()).run();
  if (!ins.meta.changes) return fail("You've already submitted today's daily.", 409, origin);

  const better = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM (SELECT client, MAX(score) AS m FROM scores WHERE mode = ? AND period = ? GROUP BY client) WHERE m > ?'
  ).bind(mode, period, score).first();
  const total = await env.DB.prepare('SELECT COUNT(DISTINCT client) AS n FROM scores WHERE mode = ? AND period = ?').bind(mode, period).first();
  return json({ score, rank: better.n + 1, of: total.n, period }, 200, origin);
}

async function board(url, env, origin) {
  const mode = url.searchParams.get('mode'), period = url.searchParams.get('period') || '', me = url.searchParams.get('client') || '';
  if (!['daily', 'free'].includes(mode) || !/^[\d.\-]{3,12}$/.test(period)) return fail('Bad request', 400, origin);
  const { results } = await env.DB.prepare(
    `SELECT name, champ, items, score, client FROM scores s
     WHERE mode = ?1 AND period = ?2 AND score = (SELECT MAX(score) FROM scores WHERE mode = ?1 AND period = ?2 AND client = s.client)
     GROUP BY client ORDER BY score DESC LIMIT 50`
  ).bind(mode, period).all();
  // Never expose other players' client ids; just flag the caller's own row.
  const rows = results.map(r => ({ name: r.name, champ: r.champ, items: r.items, score: r.score, mine: !!me && r.client === me }));
  return new Response(JSON.stringify({ rows }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15', ...cors(origin) } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    try {
      if (req.method === 'POST' && url.pathname === '/start') return await start(req, env, origin);
      if (req.method === 'POST' && url.pathname === '/submit') return await submit(req, env, origin);
      if (req.method === 'GET' && url.pathname === '/board') return await board(url, env, origin);
      if (url.pathname === '/') return json({ ok: true, service: 'Potenshall Damage leaderboard' }, 200, origin);
      return fail('Not found', 404, origin);
    } catch (e) {
      return fail('Server error', 500, origin);
    }
  },
};
