// POST {action, ...payload} -> portal data. Every call requires a valid session.
// Admin actions additionally require role=admin. All Supabase access happens here,
// server side, with the service key. The browser never touches the database.
const S = require('./_shared');

/* ---------------- rent check ---------------- */
function rentCheck(lease) {
    if (!lease || !lease.base_rent || !lease.start_date) return null;
    const start = new Date(lease.start_date);
    const years = Math.max(0, Math.floor((Date.now() - start.getTime()) / (365.25 * 24 * 3600 * 1000)));
    const esc = Number(lease.escalator_pct || 0) / 100;
    const expected = Math.round(Number(lease.base_rent) * Math.pow(1 + esc, years));
    const actual = lease.actual_rent == null ? null : Number(lease.actual_rent);
    return {
          expected, actual, years,
          ok: actual == null ? null : Math.abs(actual - expected) <= 2
    };
}

/* ---------------- sample data (until the database is connected) ---------------- */
function seed() {
    const E = (id, name, prop, addr, value, mortgage, pct, partners, lease) => ({
          id, name,
          property: { id, name: prop, address: addr, current_value: value, mortgage_amount: mortgage, lender: 'Sample Bank' },
          pct, partners,
          lease,
          statements: [
            { id: id + '-s2', period: '2026 Q2', name: name + ' - Q2 2026 Statement.pdf' },
            { id: id + '-s1', period: '2026 Q1', name: name + ' - Q1 2026 Statement.pdf' }
                ],
          documents: [
            { id: id + '-d1', kind: 'Deed', name: 'Grant Deed.pdf' },
            { id: id + '-d2', kind: 'Title', name: 'Title Policy.pdf' },
            { id: id + '-d3', kind: 'Mortgage', name: 'Loan Agreement.pdf' },
            { id: id + '-d4', kind: 'Rental Agreement', name: 'Lease + Escalators.pdf' },
            { id: id + '-d5', kind: 'Insurance', name: 'Property Insurance.pdf' }
                ],
          work: [
            { work_date: '2026-08-14', vendor: 'Sample Roofing Co', description: 'Roof inspection and patch', cost: 850 },
            { work_date: '2026-08-02', vendor: 'Sample HVAC', description: 'RTU service, filters', cost: 420 },
            { work_date: '2026-07-11', vendor: 'Sample Paving', description: 'Restripe parking field', cost: 1900 }
                ]
    });
    const me = 'Derek Germann';
    return [
          E('reno', 'RS Reno', 'Reno Industrial', 'Sample Way, Reno, NV', 4800000, 2900000, 20,
                  [{ name: me, pct: 20 }, { name: 'Partner A', pct: 40 }, { name: 'Partner B', pct: 40 }],
            { tenant: 'Sample Tenant LLC', start_date: '2022-07-01', base_rent: 24000, escalator_pct: 3, actual_rent: 24000 }),
          E('hend', 'RS Henderson', 'Henderson Industrial', 'Sample St, Henderson, NV', 5200000, 3100000, 20,
                  [{ name: me, pct: 20 }, { name: 'Partner A', pct: 40 }, { name: 'Partner B', pct: 40 }],
            { tenant: 'Sample Logistics Inc', start_date: '2023-01-01', base_rent: 26000, escalator_pct: 3, actual_rent: 28411 }),
          E('rivr', 'SRG Riverside', 'Riverside Commercial', 'Sample Ave, Riverside, CA', 6100000, 3800000, 20,
                  [{ name: me, pct: 20 }, { name: 'Partner A', pct: 50 }, { name: 'Partner B', pct: 30 }],
            { tenant: 'Sample Distribution Co', start_date: '2021-10-01', base_rent: 31000, escalator_pct: 3.5, actual_rent: 35574 }),
          E('deca', 'WHTBX Decatur', 'Decatur Property', 'Sample Blvd, Las Vegas, NV', 3900000, 2200000, 20,
                  [{ name: me, pct: 20 }, { name: 'Partner A', pct: 40 }, { name: 'Partner B', pct: 40 }],
            { tenant: 'Sample Services LLC', start_date: '2024-03-01', base_rent: 21000, escalator_pct: 3, actual_rent: 22279 }),
          E('horl', 'Horizon Ledge', 'Horizon Ledge Property', 'Sample Pkwy, Henderson, NV', 4400000, 2600000, 25,
                  [{ name: me, pct: 25 }, { name: 'Partner A', pct: 37.5 }, { name: 'Partner B', pct: 37.5 }],
            { tenant: 'Sample Trades Inc', start_date: '2022-05-01', base_rent: 23000, escalator_pct: 3, actual_rent: 25887 })
        ];
}
const seedOwners = () => ([
  { email: 'dgermann@main.inc', name: 'Derek Germann', role: 'admin', phone: '' },
  { email: 'partner-a@example.com', name: 'Partner A', role: 'owner', phone: '' },
  { email: 'partner-b@example.com', name: 'Partner B', role: 'owner', phone: '' }
  ]);

/* ---------------- db loaders ---------------- */
async function dbEntities() {
    const rows = await S.sb('/rest/v1/entities?select=id,name,' +
                                'ownership(pct,owners(name,email)),' +
                                'properties(id,name,address,current_value,mortgage_amount,lender,purchase_price,purchase_date,' +
                                'leases(id,tenant,start_date,base_rent,escalator_pct,actual_rent),' +
                                'work_log(work_date,vendor,description,cost),' +
                                'documents(id,kind,name)),' +
                                'statements(id,period,name)&order=name');
    return (rows || []).map(e => {
          const p = (e.properties && e.properties[0]) || {};
          return {
                  id: e.id, name: e.name,
                  property: { id: p.id, name: p.name, address: p.address, current_value: p.current_value, mortgage_amount: p.mortgage_amount, lender: p.lender, purchase_price: p.purchase_price, purchase_date: p.purchase_date },
                  partners: (e.ownership || []).map(o => ({ name: (o.owners && o.owners.name) || '', email: (o.owners && o.owners.email) || '', pct: Number(o.pct) })),
                  lease: (p.leases && p.leases[0]) || null,
                  statements: (e.statements || []).sort((a, b) => (a.period < b.period ? 1 : -1)),
                  documents: (p.documents || []),
                  work: (p.work_log || []).sort((a, b) => (a.work_date < b.work_date ? 1 : -1))
          };
    });
}

function shapeFor(email, ents, demo) {
    const mine = ents.map(e => {
          const my = (e.partners || []).find(p => (p.email || '').toLowerCase() === email || (demo && p.name === 'Derek Germann'));
          if (!my && !demo) return null;
          const pct = my ? Number(my.pct != null ? my.pct : e.pct) : (e.pct || 0);
          const value = Number(e.property.current_value || 0);
          const debt = Number(e.property.mortgage_amount || 0);
          const equity = value - debt;
          return {
                  id: e.id, name: e.name, property: e.property,
                  pct, partners: e.partners,
                  value, debt, equity, myEquity: Math.round(equity * pct / 100),
                  lease: e.lease, rent: rentCheck(e.lease),
                  statements: e.statements, documents: e.documents, work: e.work
          };
    }).filter(Boolean);
    const totals = mine.reduce((t, e) => ({
          value: t.value + e.value, debt: t.debt + e.debt, equity: t.equity + e.equity, myEquity: t.myEquity + e.myEquity
    }), { value: 0, debt: 0, equity: 0, myEquity: 0 });
    return { entities: mine, totals };
}

/* ---------------- handler ---------------- */
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return S.json(405, { ok: false, error: 'POST only' });
    const owner = await S.readSession(event);
    if (!owner) return S.json(401, { ok: false, error: 'Signed out.' });

    const b = S.body(event);
    const action = String(b.action || '');
    const demo = !S.hasDB();
    const needAdmin = () => owner.role !== 'admin';
    const RO = () => S.json(200, { ok: false, error: 'Connect the database to save. Sample data is read only.' });

    try {
          /* ---------- owner view ---------- */
      if (action === 'portfolio') {
              const ents = demo ? seed() : await dbEntities();
              const shaped = shapeFor(owner.email.toLowerCase(), ents, demo);
              return S.json(200, Object.assign({ ok: true, demo, me: owner }, shaped));
      }

      /* ---------- admin ---------- */
      if (action.startsWith('admin.')) {
              if (needAdmin()) return S.json(403, { ok: false, error: 'Admin only.' });

            if (action === 'admin.overview') {
                      const ents = demo ? seed() : await dbEntities();
                      const owners = demo ? seedOwners() : await S.sb('/rest/v1/owners?select=email,name,role,phone&order=name');
                      const all = ents.map(e => {
                                  const value = Number(e.property.current_value || 0), debt = Number(e.property.mortgage_amount || 0);
                                  return Object.assign({}, e, { value, debt, equity: value - debt, rent: rentCheck(e.lease) });
                      });
                      return S.json(200, { ok: true, demo, owners, entities: all });
            }
              if (demo) return RO();

            if (action === 'admin.add_property') {
                      let entityId = b.entity_id;
                      if (!entityId) {
                                  const ent = await S.sb('/rest/v1/entities', { method: 'POST', body: { name: b.entity_name } });
                                  entityId = ent[0].id;
                      }
                      const p = await S.sb('/rest/v1/properties', { method: 'POST', body: {
                                  entity_id: entityId, name: b.name, address: b.address || null,
                                  purchase_price: b.purchase_price || null, purchase_date: b.purchase_date || null,
                                  current_value: b.current_value || null, mortgage_amount: b.mortgage_amount || null, lender: b.lender || null
                      }});
                      return S.json(200, { ok: true, property: p[0] });
            }
              if (action === 'admin.add_lease') {
                        await S.sb('/rest/v1/leases?property_id=eq.' + b.property_id, { method: 'DELETE', prefer: 'return=minimal' });
                        const l = await S.sb('/rest/v1/leases', { method: 'POST', body: {
                                    property_id: b.property_id, tenant: b.tenant || null, start_date: b.start_date,
                                    base_rent: b.base_rent, escalator_pct: b.escalator_pct || 0, actual_rent: b.actual_rent || null, notes: b.notes || null
                        }});
                        return S.json(200, { ok: true, lease: l[0], rent: rentCheck(l[0]) });
              }
              if (action === 'admin.add_work') {
                        const w = await S.sb('/rest/v1/work_log', { method: 'POST', body: {
                                    property_id: b.property_id, work_date: b.work_date, vendor: b.vendor || null, description: b.description, cost: b.cost || 0
                        }});
                        return S.json(200, { ok: true, work: w[0] });
              }
              if (action === 'admin.add_owner') {
                        const o = await S.sb('/rest/v1/owners', { method: 'POST', body: {
                                    email: String(b.email || '').trim().toLowerCase(), name: b.name, phone: b.phone || null, role: b.role === 'admin' ? 'admin' : 'owner'
                        }});
                        return S.json(200, { ok: true, owner: o[0] });
              }
              if (action === 'admin.set_ownership') {
                        const os = await S.sb('/rest/v1/owners?email=eq.' + encodeURIComponent(String(b.owner_email || '').toLowerCase()) + '&select=id');
                        if (!os || !os[0]) return S.json(200, { ok: false, error: 'No owner with that email. Add the owner first.' });
                        await S.sb('/rest/v1/ownership?entity_id=eq.' + b.entity_id + '&owner_id=eq.' + os[0].id, { method: 'DELETE', prefer: 'return=minimal' });
                        await S.sb('/rest/v1/ownership', { method: 'POST', body: { entity_id: b.entity_id, owner_id: os[0].id, pct: b.pct } });
                        return S.json(200, { ok: true });
              }
              if (action === 'admin.add_statement') {
                        const st = await S.sb('/rest/v1/statements', { method: 'POST', body: { entity_id: b.entity_id, period: b.period, name: b.name } });
                        return S.json(200, { ok: true, statement: st[0] });
              }
              if (action === 'admin.add_document_meta') {
                        const d = await S.sb('/rest/v1/documents', { method: 'POST', body: { property_id: b.property_id, kind: b.kind, name: b.name } });
                        return S.json(200, { ok: true, document: d[0] });
              }
      }

      return S.json(400, { ok: false, error: 'Unknown action.' });
    } catch (e) {
          console.log('data error', action, e.message);
          return S.json(200, { ok: false, error: 'Server error. Try again.' });
    }
};
