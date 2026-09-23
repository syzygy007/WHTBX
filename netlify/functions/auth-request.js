// POST {email} -> emails a 6 digit code.
// With the database connected: single use code stored hashed, 5 attempt limit.
// Without: stateless HMAC challenge (fallback).
const S = require('./_shared');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return S.json(405, { ok: false, error: 'POST only' });
    await S.delay(350);

    const email = String((S.body(event).email || '')).trim().toLowerCase();
    if (!email || !email.includes('@')) return S.json(400, { ok: false, error: 'Enter a valid email.' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const challenge = S.makeChallenge(email, code);
    const owner = await S.ownerByEmail(email).catch(() => null);

    // Unknown emails get a real looking response and no mail: no account enumeration.
    if (!owner) return S.json(200, { ok: true, sig: challenge.sig, exp: challenge.exp });

    if (S.hasDB()) {
          try {
                  await S.sb('/rest/v1/auth_codes?email=eq.' + encodeURIComponent(email), { method: 'DELETE', prefer: 'return=minimal' });
                  await S.sb('/rest/v1/auth_codes', { method: 'POST', body: { email, code_hash: S.hash(code), expires_at: new Date(Date.now() + S.CODE_TTL_MS).toISOString(), attempts: 0 } });
          } catch (e) { console.log('code store error', e.message); return S.json(200, { ok: false, error: 'Could not start sign in. Try again.' }); }
    }

    const key = process.env.RESEND_API_KEY;
    if (!key) return S.json(200, { ok: false, error: 'Email sending is not configured yet.' });

    const from = process.env.RESEND_FROM || 'WHTBX <onboarding@resend.dev>';
    const html = `
      <div style="background:#101010;padding:48px 24px;font-family:Arial,sans-serif">
          <div style="max-width:440px;margin:0 auto;background:#181715;border:1px solid #2A2926;padding:44px 36px">
                <div style="font-size:12px;letter-spacing:6px;color:#98938B;font-weight:bold">WHTBX</div>
                      <div style="font-size:22px;color:#EDEAE4;margin-top:18px">Your sign in code.</div>
                            <div style="font-size:44px;letter-spacing:14px;color:#EDEAE4;margin:26px 0;font-weight:bold">${code}</div>
                                  <div style="font-size:13px;color:#98938B;line-height:1.6">This code expires in 10 minutes and works once. If you did not request it, ignore this email.</div>
                                        <div style="font-size:10px;letter-spacing:3px;color:#6E6A63;margin-top:34px">OWNER PORTAL &middot; WHTBXCO</div>
                                            </div>
                                              </div>`;

    try {
          const r = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ from, to: [email], subject: 'WHTBX sign in code - ' + code, html })
          });
          if (!r.ok) { console.log('resend error', r.status, await r.text()); return S.json(200, { ok: false, error: 'Could not send the email. Try again shortly.' }); }
    } catch (e) { console.log('resend exception', e.message); return S.json(200, { ok: false, error: 'Could not send the email. Try again shortly.' }); }

    return S.json(200, { ok: true, sig: challenge.sig, exp: challenge.exp });
};
