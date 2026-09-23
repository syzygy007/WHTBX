// POST {email, code, sig, exp} -> sets 30 day session cookie, returns {ok, owner}
const S = require('./_shared');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return S.json(405, { ok: false, error: 'POST only' });
    await S.delay(350);

    const b = S.body(event);
    const email = String(b.email || '').trim().toLowerCase();
    const code = String(b.code || '').trim();
    const fail = () => S.json(200, { ok: false, error: 'That code did not match or has expired.' });

    const owner = await S.ownerByEmail(email).catch(() => null);
    if (!owner) return fail();

    if (S.hasDB()) {
          try {
                  const rows = await S.sb('/rest/v1/auth_codes?email=eq.' + encodeURIComponent(email) + '&select=*');
                  const c = rows && rows[0];
                  if (!c) return fail();
                  if (new Date(c.expires_at).getTime() < Date.now() || c.attempts >= S.MAX_CODE_ATTEMPTS) {
                            await S.sb('/rest/v1/auth_codes?email=eq.' + encodeURIComponent(email), { method: 'DELETE', prefer: 'return=minimal' });
                            return fail();
                  }
                  if (!S.safeEqual(c.code_hash, S.hash(code))) {
                            await S.sb('/rest/v1/auth_codes?email=eq.' + encodeURIComponent(email), { method: 'PATCH', body: { attempts: c.attempts + 1 }, prefer: 'return=minimal' });
                            return fail();
                  }
                  // single use
            await S.sb('/rest/v1/auth_codes?email=eq.' + encodeURIComponent(email), { method: 'DELETE', prefer: 'return=minimal' });
          } catch (e) { console.log('verify error', e.message); return fail(); }
    } else {
          if (!S.checkChallenge(email, code, b.exp, b.sig)) return fail();
    }

    const cookie = await S.createSession(email);
    return S.json(200, { ok: true, owner: { email, name: owner.name, role: owner.role || 'owner' } }, { 'Set-Cookie': cookie });
};
