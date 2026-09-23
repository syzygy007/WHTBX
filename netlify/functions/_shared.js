// WHTBX portal - shared helpers (v4, Sep 2026)
// All data access is server side. The browser only ever talks to these
// same-origin functions; the Supabase service key never leaves the server.
const crypto = require('crypto');

const SECRET = process.env.WHTBX_SECRET || 'set-WHTBX_SECRET-in-netlify-env';

// ---------- Supabase (REST, no client library needed) ----------
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const hasDB = () => !!(SB_URL && SB_KEY);

async function sb(path, opts) {
    const o = opts || {};
    const r = await fetch(SB_URL.replace(/\/$/, '') + path, {
          method: o.method || 'GET',
          headers: Object.assign({
                  'apikey': SB_KEY,
                  'Authorization': 'Bearer ' + SB_KEY,
                  'Content-Type': 'application/json',
                  'Prefer': o.prefer || 'return=representation'
          }, o.headers || {}),
          body: o.body ? JSON.stringify(o.body) : undefined
    });
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
    if (!r.ok) { const err = new Error('supabase ' + r.status + ' ' + (typeof j === 'string' ? j : JSON.stringify(j))); err.status = r.status; throw err; }
    return j;
}

// ---------- fallback owner allowlist (used until the database is connected) ----------
const OWNERS = {
    'dgermann@main.inc': { name: 'Derek Germann', role: 'admin' }
};

// ---------- crypto ----------
function hmac(data) { return crypto.createHmac('sha256', SECRET).update(data).digest('hex'); }
function hash(data) { return crypto.createHash('sha256').update(data + '|' + SECRET).digest('hex'); }
function safeEqual(a, b) {
    const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function token() { return crypto.randomBytes(32).toString('base64url'); }

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_CODE_ATTEMPTS = 5;

// ---------- stateless challenge (fallback path, no DB) ----------
function makeChallenge(email, code) {
    const exp = Date.now() + CODE_TTL_MS;
    const sig = hmac(['code', email, code, exp].join('|'));
    return { exp, sig };
}
function checkChallenge(email, code, exp, sig) {
    if (!email || !code || !exp || !sig) return false;
    if (Date.now() > Number(exp)) return false;
    return safeEqual(hmac(['code', email, code, exp].join('|')), sig);
}

// ---------- sessions ----------
function cookieOf(val, maxAge) {
    return 'whtbx=' + val + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + maxAge;
}
async function createSession(email) {
    if (hasDB()) {
          const t = token();
          await sb('/rest/v1/sessions', { method: 'POST', body: { token_hash: hash(t), email, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() } });
          return cookieOf(t, Math.floor(SESSION_TTL_MS / 1000));
    }
    const exp = Date.now() + SESSION_TTL_MS;
    const sig = hmac(['sess', email, exp].join('|'));
    const val = Buffer.from(JSON.stringify({ email, exp, sig })).toString('base64url');
    return cookieOf(val, Math.floor(SESSION_TTL_MS / 1000));
}
function clearSessionCookie() { return cookieOf('', 0); }

async function ownerByEmail(email) {
    if (hasDB()) {
          const rows = await sb('/rest/v1/owners?email=eq.' + encodeURIComponent(email) + '&select=*');
          return rows && rows[0] ? rows[0] : null;
    }
    return OWNERS[email] ? Object.assign({ email }, OWNERS[email]) : null;
}

async function readSession(event) {
    try {
          const raw = (event.headers.cookie || event.headers.Cookie || '');
          const m = raw.match(/(?:^|;\s*)whtbx=([^;]+)/);
          if (!m || !m[1]) return null;
          if (hasDB()) {
                  const rows = await sb('/rest/v1/sessions?token_hash=eq.' + hash(m[1]) + '&select=email,expires_at');
                  const s = rows && rows[0];
                  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
                  const o = await ownerByEmail(s.email);
                  return o ? { email: s.email, name: o.name, role: o.role || 'owner' } : null;
          }
          const s = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
          if (!s.email || Date.now() > Number(s.exp)) return null;
          if (!safeEqual(hmac(['sess', s.email, s.exp].join('|')), s.sig)) return null;
          const o = OWNERS[s.email];
          return o ? { email: s.email, name: o.name, role: o.role || 'owner' } : null;
    } catch (e) { return null; }
}

async function destroySession(event) {
    try {
          if (!hasDB()) return;
          const raw = (event.headers.cookie || event.headers.Cookie || '');
          const m = raw.match(/(?:^|;\s*)whtbx=([^;]+)/);
          if (m && m[1]) await sb('/rest/v1/sessions?token_hash=eq.' + hash(m[1]), { method: 'DELETE', prefer: 'return=minimal' });
    } catch (e) { /* best effort */ }
}

// ---------- misc ----------
function json(statusCode, obj, extraHeaders) {
    return { statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extraHeaders || {}), body: JSON.stringify(obj) };
}
function body(event) { try { return JSON.parse(event.body || '{}'); } catch (e) { return {}; } }
const delay = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
    SECRET, hasDB, sb, OWNERS,
    hmac, hash, safeEqual, token,
    CODE_TTL_MS, SESSION_TTL_MS, MAX_CODE_ATTEMPTS,
    makeChallenge, checkChallenge,
    createSession, clearSessionCookie, readSession, destroySession, ownerByEmail,
    json, body, delay
};
