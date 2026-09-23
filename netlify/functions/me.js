// POST -> {ok, owner} when the session cookie is valid
const S = require('./_shared');

exports.handler = async (event) => {
    const owner = await S.readSession(event);
    if (!owner) return S.json(401, { ok: false });
    return S.json(200, { ok: true, owner });
};
