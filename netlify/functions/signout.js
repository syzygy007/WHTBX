// POST -> clears the session cookie (and deletes the server side session)
const S = require('./_shared');

exports.handler = async (event) => {
    await S.destroySession(event);
    return S.json(200, { ok: true }, { 'Set-Cookie': S.clearSessionCookie() });
};
