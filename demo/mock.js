/* Démo : imite l'API PHP dans le navigateur (données fictives en localStorage). */
(function () {
  'use strict';
  const KEY = 'badges-demo-v6';
  // Numéros et types des lots de l'immeuble (aucun nom ni identifiant réel) ; propriétaires fictifs
  const DEMO_GROUPS = /*DEMO_GROUPS*/[];
  const SERIAL_MIN = 4, SERIAL_MAX = 32;
  let mem = null;

  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mem = null; }
    if (!mem) mem = seed();
    return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* stockage indisponible : la démo reste en mémoire */ } }
  function now() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function seed() {
    const t = now();
    const lots = [];
    DEMO_GROUPS.forEach((g, i) => {
      const fictifs = { 3: 'LEROY Paul', 4: 'LEROY Anne', 7: 'MOREAU - FAURE', 8: 'GARNIER Lucie', 9: 'ROUSSEL Marc', 12: 'LEROY Paul' }; // LEROY Paul a deux identifiants : visible dans la vue « Par copropriétaire »
      const owner = i === 1 ? { name: 'DUPONT Exemple', login: 'C543210' } : { name: fictifs[i] || `COPROPRIÉTAIRE FICTIF ${i + 1}`, login: 'C5' + String(43210 + i + 1).padStart(5, '0') };
      g.forEach(([numero, libelle]) => lots.push(Object.assign({ numero }, lotRecord(libelle, ...splitName(owner.name), owner.login))));
    });
    lots.sort((a, b) => a.numero - b.numero);
    const g5 = DEMO_GROUPS[5] || [['1']];
    const bernardLot = (g5.find((l) => l[1] === 'Appartement') || g5[0])[0];
    // Liste fictive de la centrale actuelle (aucun nom ni numéro réel)
    const hex = (i) => ((0x2F1A0000 + i * 0x9E3B7) >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(-8);
    const central = [];
    for (let i = 1; i <= 40; i++) central.push({ name: String(i).padStart(3, '0'), identifiant: '', raw_serial: i % 13 === 0 ? '' : 'S-' + hex(i) });
    [['DUPONT', '', 'S-7C41A3D2'], ['DUPONT', '', 'S-7C41B0E8'], ['BERNARD', '', 'S-5E20C917'], ['MARTIN', '', 'S-2B9F44A1'],
     ['GARDIEN', '', 'S-0D13E6F5'], ['FICTIF SEPT', '304', 'S-4A6B8C2D'], ['FICTIF HUIT', '', ''], ['INSTALLATEUR Mise en service', '', 'S-9F0E1D2C'],
     ['FICTIF NEUF', '', 'S-4A6B8C2D'], ['LEROY', '', 'S-6D2E9A41'], ['MOREAU', '', 'S-1F7C3B58'], ['PETIT GARNIER', '', 'S-8A0D4C63'],
     ['ROUSEL', '', 'S-3E5B7D92'], ['TOURNEUR', '', 'S-5C8E1A07']].forEach(([name, identifiant, raw_serial]) => central.push({ name, identifiant, raw_serial }));
    central.forEach((r, i) => { r.id = i + 1; r.serial = normSerial(r.raw_serial); });
    return {
      central, central_imported_at: t, matches: {},
      seq: 10, badgeSeq: 10, lots, codes: {}, session: { resident: null, admin: false },
      declarations: [
        { id: 1, lot: '102', nom: 'Exemple Dupont', id_syndic: 'C543210', email: 'exemple.dupont@exemple.fr', created_at: t, updated_at: t,
          badges: [
            { id: 1, serial: '04A7C2E1', stair_a: true, stair_b: false, stair_c: false, occupant: 'coproprietaire', tenant_name: null, tenant_phone: null, tenant_email: null, created_at: t, updated_at: t },
            { id: 2, serial: '04A7C2E2', stair_a: true, stair_b: false, stair_c: true, parking: true, occupant: 'coproprietaire', tenant_name: null, tenant_phone: null, tenant_email: null, created_at: t, updated_at: t },
          ] },
        { id: 2, lot: bernardLot, nom: 'Exemple Bernard', id_syndic: null, email: null, created_at: t, updated_at: t,
          badges: [
            { id: 3, serial: '3B9F0D11', stair_a: false, stair_b: true, stair_c: false, occupant: 'locataire', tenant_name: 'Exemple Locataire', tenant_phone: '0600000000', tenant_email: null, created_at: t, updated_at: t },
          ],
          reports: [{ serial: '5E20C917', answer: 'perdu', created_at: t }] },
      ],
    };
  }

  const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120);
  const normSerial = (s) => { s = String(s || '').replace(/[\s\-:.]/g, '').toUpperCase(); return /^S[0-9A-F]+$/.test(s) ? s.slice(1) : s; };
  const serialError = (s) => {
    if (!s) return 'Le numéro de série est obligatoire.';
    if (!/^[0-9A-F]+$/.test(s)) return 'Le numéro ne doit contenir que des chiffres 0–9 et des lettres A–F.';
    if (s.length < SERIAL_MIN || s.length > SERIAL_MAX) return `Le numéro doit faire entre ${SERIAL_MIN} et ${SERIAL_MAX} caractères.`;
    return null;
  };
  function splitName(full) {
    const w = String(full || '').trim().split(/\s+/).filter(Boolean);
    let i = w.length;
    while (i > 0 && /\p{Ll}/u.test(w[i - 1])) i--;
    return [w.slice(0, i).join(' '), w.slice(i).join(' ')];
  }
  function lotRecord(libelle, last, first, login) {
    last = String(last || '').trim().toUpperCase(); first = String(first || '').trim();
    const full = (last + ' ' + first).trim();
    return { libelle: libelle || null, owner_lastname: last || null, owner_firstname: first || null, owner_name: full || null, owner_login: login || null };
  }
  const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const normPhone = (p) => String(p || '').replace(/[\s.\-()]/g, '').replace(/^\+33|^0033/, '0');
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const ok = (o) => Object.assign({ ok: true, status: 200 }, o || {});
  const err = (msg, status, extra) => Object.assign({ ok: false, error: msg, status: status || 400 }, extra || {});
  const invalid = (errors) => ({ ok: false, error: 'Certaines informations sont à corriger.', errors, status: 422 });

  function serialTaken(serial, ignoreDecl) {
    return load().declarations.some((d) => d.id !== ignoreDecl && d.badges.some((b) => b.serial === serial));
  }

  /* ---------- Liste de la centrale (fictive) ---------- */
  const STOP = ['GARDIEN', 'SYNDIC', 'SINDIC', 'MISE', 'SERVICE', 'AXE', 'VAN', 'DES', 'LES', 'MME', 'SCI', 'PLUS', 'EXEMPLE', 'FICTIF', 'COPROPRIETAIRE', 'INSTALLATEUR'];
  const nameTokens = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3 && !STOP.includes(w));
  const tokenOf = (serial) => 'k' + [...serial].reverse().join('').toLowerCase() + 'x';
  const hintOf = (serial) => serial.slice(-4);
  function identityTokens(inp) {
    const db = load();
    let t = nameTokens(inp.nom);
    const lot = String(Number(clean(inp.lot, 4)) || '');
    const l = db.lots.find((x) => x.numero === lot); if (l) t = t.concat(nameTokens(l.owner_name));
    const login = clean(inp.id_syndic, 20).toUpperCase();
    const o = db.lots.find((x) => x.owner_login && x.owner_login === login); if (o) t = t.concat(nameTokens(o.owner_name));
    return [...new Set(t)];
  }
  function identityLogins(inp) {
    const db = load(), out = new Set();
    const lot = String(Number(clean(inp.lot, 4)) || '');
    const l = db.lots.find((x) => x.numero === lot); if (l && l.owner_login) out.add(l.owner_login);
    const login = clean(inp.id_syndic, 20).toUpperCase();
    if (db.lots.some((x) => x.owner_login === login)) out.add(login);
    return [...out];
  }
  const centralKey = (name, serial) => clean(name).toUpperCase() + '|' + (serial || '');
  function suggestions(inp, declId) {
    const db = load(), toks = identityTokens(inp), typed = nameTokens(inp.nom), logins = identityLogins(inp);
    if (!toks.length && !logins.length) return [];
    const taken = new Set(); db.declarations.forEach((d) => { if (d.id !== declId) d.badges.forEach((b) => taken.add(b.serial)); });
    const out = new Map();
    (db.central || []).forEach((r) => {
      if (!r.serial || out.has(r.serial) || taken.has(r.serial)) return;
      const rt = nameTokens(r.name), dec = (db.matches || {})[centralKey(r.name, r.serial)];
      const match = dec ? ((dec.status === 'valide' && logins.includes(dec.owner_login)) || rt.some((w) => typed.includes(w))) : rt.some((w) => toks.includes(w));
      if (match) out.set(r.serial, { serial: r.serial, token: tokenOf(r.serial), hint: hintOf(r.serial) });
    });
    return [...out.values()];
  }

  /* ---------- Rapprochement centrale / syndic ---------- */
  function ownersIndex() {
    const m = {};
    load().lots.forEach((l) => {
      if (!l.owner_login) return;
      const o = m[l.owner_login] = m[l.owner_login] || { login: l.owner_login, name: l.owner_name, lots: [], tokens: nameTokens(l.owner_name) };
      o.lots.push({ numero: String(l.numero).padStart(4, '0'), libelle: l.libelle });
    });
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name));
  }
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const similar = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1);
  function candidates(tokens, owners) {
    if (!tokens.length) return [];
    const out = [];
    owners.forEach((o) => {
      let hit = 0, long = false;
      tokens.forEach((t) => { const u = o.tokens.find((x) => similar(t, x)); if (u) { hit += u === t ? 1 : 0.75; long = long || t.length >= 5; } });
      if (hit) out.push({ o, score: hit / tokens.length, cover: o.tokens.length ? hit / o.tokens.length : 0, long });
    });
    return out.sort((a, b) => b.score - a.score || b.cover - a.cover);
  }
  function level(c) {
    if (!c.length) return 'aucune';
    const ties = c.filter((x) => x.score === c[0].score).length;
    if (c[0].score >= 1 && ties === 1) return 'sure';
    return c[0].score >= 0.5 || c[0].long ? 'probable' : 'faible';
  }
  const pubOwner = (o) => ({ login: o.login, name: o.name, lots: o.lots });
  function matchingRows() {
    const db = load(), owners = ownersIndex(), byLogin = Object.fromEntries(owners.map((o) => [o.login, o]));
    return (db.central || []).filter((r) => r.name && !/^\d+$/.test(r.name)).map((r) => {
      const c = candidates(nameTokens(r.name), owners), key = centralKey(r.name, r.serial), d = (db.matches || {})[key];
      const owner = d && d.owner_login ? (byLogin[d.owner_login] ? pubOwner(byLogin[d.owner_login]) : { login: d.owner_login, name: null, lots: [] }) : null;
      return { id: r.id, key, name: r.name, identifiant: r.identifiant, raw_serial: r.raw_serial, level: level(c),
        candidates: c.slice(0, 5).map((x) => Object.assign(pubOwner(x.o), { score: Math.round(x.score * 100) / 100 })),
        decision: d ? Object.assign({ status: d.status, decided_at: d.decided_at }, owner ? { owner } : {}) : null };
    });
  }
  function tokenMap(inp, declId) {
    const m = {};
    suggestions(inp, declId).forEach((x) => { m[x.token] = x.serial; });
    const d = declId && load().declarations.find((x) => x.id === declId);
    if (d) {
      d.badges.filter((b) => b.from_central).forEach((b) => { m[tokenOf(b.serial)] = b.serial; });
      (d.reports || []).forEach((r) => { m[tokenOf(r.serial)] = r.serial; });
    }
    return m;
  }
  function publicDecl(d) {
    d = copy(d);
    d.badges.forEach((b) => { if (b.from_central) { b.known_token = tokenOf(b.serial); b.hint = hintOf(b.serial); b.serial = ''; } delete b.from_central; });
    d.central_answers = (d.reports || []).map((r) => ({ token: tokenOf(r.serial), hint: hintOf(r.serial), answer: r.answer }));
    delete d.reports;
    return d;
  }
  function centralNames() {
    const m = {};
    (load().central || []).forEach((r) => { if (r.serial) (m[r.serial] = m[r.serial] || []).push(r.name); });
    return m;
  }
  function centralRows() {
    const db = load();
    const who = (d) => [d.lot ? 'Lot ' + String(d.lot).padStart(4, '0') : null, d.nom, d.id_syndic].filter(Boolean).join(' · ');
    const declared = {}, reports = {};
    db.declarations.forEach((d) => {
      d.badges.forEach((b) => { declared[b.serial] = { who: who(d), date: b.created_at }; });
      (d.reports || []).forEach((r) => { ((reports[r.serial] = reports[r.serial] || {})[r.answer] = reports[r.serial][r.answer] || []).push({ who: who(d), date: r.created_at }); });
    });
    const count = {}; (db.central || []).forEach((r) => { if (r.serial) count[r.serial] = (count[r.serial] || 0) + 1; });
    const names = Object.fromEntries(db.lots.filter((l) => l.owner_login).map((l) => [l.owner_login, l.owner_name]));
    return (db.central || []).map((r) => {
      const dec = (db.matches || {})[centralKey(r.name, r.serial)];
      const x = Object.assign({}, r, { duplicate: !!r.serial && count[r.serial] > 1, detail: '', date: null,
        match: dec ? { status: dec.status, login: dec.owner_login, name: dec.owner_login ? names[dec.owner_login] || null : null } : null });
      const rep = reports[r.serial] || {};
      if (!r.serial) x.status = 'sans_numero';
      else if (declared[r.serial]) Object.assign(x, { status: 'declare', detail: declared[r.serial].who, date: declared[r.serial].date });
      else if (rep.perdu) Object.assign(x, { status: 'perdu', detail: rep.perdu.map((y) => y.who).join(' / '), date: rep.perdu.at(-1).date });
      else if (rep.pas_a_moi) Object.assign(x, { status: 'pas_a_moi', detail: rep.pas_a_moi.map((y) => y.who).join(' / '), date: rep.pas_a_moi.at(-1).date });
      else x.status = 'non_declare';
      return x;
    });
  }
  function parseCentral(content) {
    const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const first = lines.find((l) => l.trim()) || '';
    const sep = first.includes('\t') ? '\t' : ((first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',');
    const cols = { name: 0, identifiant: 1, serial: 2 };
    let hasHeader = false;
    first.split(sep).map((c) => c.trim().toLowerCase()).forEach((h, i) => {
      if (h === 'nom' || h.startsWith('nom ')) { cols.name = i; hasHeader = true; } else if (h.includes('identifiant')) cols.identifiant = i; else if (h.includes('code') || h.includes('rie')) cols.serial = i;
    });
    const rows = []; let skipped = !hasHeader;
    lines.forEach((l) => {
      if (!l.trim()) return;
      if (!skipped) { skipped = true; return; }
      const c = l.split(sep).map((x) => x.replace(/^"|"$/g, ''));
      const name = clean(c[cols.name]), identifiant = clean(c[cols.identifiant], 40), raw = clean(c[cols.serial], 40);
      if (!name && !identifiant && !raw) return;
      const sn = normSerial(raw);
      rows.push({ id: rows.length + 1, name, identifiant, raw_serial: raw, serial: serialError(sn) ? '' : sn });
    });
    return rows;
  }

  function validateAll(inp, declId, map, admin) {
    const db = load();
    const errors = {};
    let lot = clean(inp.lot, 4);
    if (/^\d{1,4}$/.test(lot) && Number(lot) > 0) lot = String(Number(lot));
    const nom = clean(inp.nom, 80), syn = clean(inp.id_syndic, 20).toUpperCase(), email = clean(inp.email, 160).toLowerCase();
    if (!lot && !nom && !syn) errors.identity = 'Indiquez au moins un numéro de lot, un nom ou un identifiant syndic.';
    if (lot) {
      if (!/^\d{1,4}$/.test(lot) || Number(lot) === 0) errors.lot = 'Le numéro de lot comporte 1 à 4 chiffres (ex. 0102).';
      else if (db.lots.length && !db.lots.some((l) => l.numero === lot)) errors.lot = `Le lot ${lot} n'existe pas dans la liste de l'immeuble.`;
    }
    if (syn && !/^[A-Z][0-9]{6}$/.test(syn)) errors.id_syndic = "L'identifiant syndic est une lettre suivie de 6 chiffres (ex. C543210).";
    if (email && !isEmail(email)) errors.email = "L'adresse email n'est pas valide.";
    const raw = Array.isArray(inp.badges) ? inp.badges : [];
    const badges = [], detail = {}, seen = {};
    const answers = Array.isArray(inp.central_answers) ? inp.central_answers : [];
    if (!raw.length && !(map && answers.length)) errors.badges = 'Ajoutez au moins un badge.';
    raw.forEach((b, i) => {
      const e = {};
      let fromCentral = admin ? !!b.from_central : false;
      if (!admin && b.known_token) {
        const known = map && map[b.known_token];
        if (!known) { detail[i] = { serial: 'Ce badge de l’ancienne centrale n’a pas pu être vérifié. Rechargez la page.' }; return; }
        b = Object.assign({}, b, { serial: known }); fromCentral = true;
      }
      const serial = normSerial(b.serial);
      const se = serialError(serial);
      if (se) e.serial = se;
      else if (seen[serial]) e.serial = 'Ce numéro figure deux fois dans votre déclaration.';
      else if (serialTaken(serial, declId)) e.serial = 'Ce badge est déjà déclaré.';
      seen[serial] = true;
      if (!b.stair_a && !b.stair_b && !b.stair_c && !b.parking) e.stairs = 'Cochez au moins un escalier ou la télécommande de parking.';
      if (!['coproprietaire', 'locataire'].includes(b.occupant)) e.occupant = 'Indiquez s’il s’agit d’un copropriétaire ou d’un locataire.';
      const loc = b.occupant === 'locataire';
      const phone = loc ? normPhone(b.tenant_phone) : '';
      const temail = loc ? clean(b.tenant_email, 160).toLowerCase() : '';
      if (phone && !/^0[1-9]\d{8}$/.test(phone)) e.tenant_phone = 'Numéro de téléphone français attendu (10 chiffres).';
      if (temail && !isEmail(temail)) e.tenant_email = "L'adresse email du locataire n'est pas valide.";
      if (Object.keys(e).length) { detail[i] = e; return; }
      badges.push({ id: b.id || null, from_central: fromCentral, serial, stair_a: !!b.stair_a, stair_b: !!b.stair_b, stair_c: !!b.stair_c, parking: !!b.parking, occupant: b.occupant,
        tenant_name: loc ? clean(b.tenant_name, 80) || null : null, tenant_phone: phone || null, tenant_email: temail || null });
    });
    if (Object.keys(detail).length) { errors.badges_detail = detail; errors.badges = 'Un ou plusieurs badges sont à corriger.'; }
    if (Object.keys(errors).length) return { errors };
    let reports = null;
    if (map) {
      const declaredSet = new Set(badges.map((b) => b.serial)), byS = {};
      answers.forEach((a) => { const sn = map[a.token]; if (sn && ['perdu', 'pas_a_moi'].includes(a.answer) && !declaredSet.has(sn)) byS[sn] = { serial: sn, answer: a.answer, created_at: now() }; });
      reports = Object.values(byS);
      if (!badges.length && !reports.length) return { errors: { badges: 'Ajoutez au moins un badge.' } };
    }
    return { identity: { lot: lot || null, nom: nom || null, id_syndic: syn || null, email: email || null }, badges, reports };
  }

  function saveDecl(declId, identity, badges, reports) {
    const db = load(), t = now();
    let d = declId ? db.declarations.find((x) => x.id === declId) : null;
    if (!d) { d = { id: ++db.seq, created_at: t, badges: [] }; db.declarations.unshift(d); }
    const old = {};
    d.badges.forEach((b) => { old[b.id] = b; });
    Object.assign(d, identity, { updated_at: t });
    d.badges = badges.map((b) => {
      const prev = b.id && old[b.id];
      return Object.assign({}, b, { id: prev ? b.id : ++db.badgeSeq, created_at: prev ? prev.created_at : t, updated_at: t });
    });
    if (reports) d.reports = reports; else d.reports = d.reports || [];
    save();
    return d;
  }

  function parseLots(content) {
    content = content.replace(/^\uFEFF/, '').trim();
    const lots = {};
    if (content[0] === '{' || content[0] === '[') {
      let j;
      try { j = JSON.parse(content); } catch (e) { return null; }
      (Array.isArray(j) ? j : (j.data || [])).forEach((o) => {
        if (!o || typeof o !== 'object') return;
        const [last, first] = splitName(clean(o.computedName, 120)), login = clean(o.login, 20).toUpperCase() || null;
        (o.lots || []).forEach((l) => {
          const m = String((l && l.name) || '').match(/^\s*(\d{1,4})\s*(?:\((.*)\))?/);
          if (!m || Number(m[1]) === 0) return;
          const t = (m[2] || '').trim();
          lots[String(Number(m[1]))] = lotRecord(t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : null, last, first, login);
        });
      });
    } else {
      const lines = content.split(/\r\n|\r|\n/);
      const first = lines.find((l) => l.trim()) || '';
      const sep = first.includes('\t') ? '\t' : ((first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',');
      const cols = { numero: 0, libelle: 1, nom: null, prenom: null, login: null };
      first.split(sep).forEach((h, i) => {
        h = h.replace(/^"|"$/g, '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (h.includes('prenom')) cols.prenom = i; else if (h.includes('identifiant') || h.includes('login')) cols.login = i;
        else if (h.includes('numero') || h === 'lot') cols.numero = i; else if (h.includes('type') || h.includes('libelle')) cols.libelle = i;
        else if (h === 'nom' || h.includes('coproprietaire')) cols.nom = i;
      });
      lines.forEach((line) => {
        const c = line.split(sep).map((x) => x.replace(/^"|"$/g, '').trim());
        const num = c[cols.numero] || '';
        if (!/^\d{1,4}$/.test(num) || Number(num) === 0) return;
        const get = (k) => (cols[k] == null ? '' : clean(c[cols[k]]));
        const login = get('login').toUpperCase();
        lots[String(Number(num))] = lotRecord(get('libelle') || null, get('nom'), get('prenom'), /^[A-Z][0-9]{6}$/.test(login) ? login : null);
      });
    }
    return Object.entries(lots).map(([numero, l]) => Object.assign({ numero }, l));
  }

  function syndicIndex() {
    const idx = { byLot: {}, byLogin: {} };
    load().lots.forEach((l) => {
      if (!l.owner_login) return;
      const o = { name: l.owner_name, login: l.owner_login };
      idx.byLot[l.numero] = o;
      idx.byLogin[l.owner_login] = idx.byLogin[l.owner_login] || o;
    });
    return idx;
  }
  const tokens = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3);
  function syndicCheck(d, idx) {
    if (!Object.keys(idx.byLogin).length) return null;
    const issues = [], owners = [];
    if (d.lot) { if (idx.byLot[d.lot]) owners.push(idx.byLot[d.lot]); else issues.push('Lot inconnu du syndic'); }
    if (d.id_syndic) {
      const k = idx.byLogin[d.id_syndic];
      if (!k) issues.push('Identifiant syndic inconnu');
      else if (d.lot && owners.length && owners[0].login !== d.id_syndic) { issues.push('Identifiant syndic d’un autre copropriétaire que le lot'); owners.push(k); }
      else if (!owners.length) owners.push(k);
    }
    if (d.nom && owners.length) {
      const dec = tokens(d.nom);
      if (!owners.some((o) => tokens(o.name).some((t) => dec.includes(t)))) issues.push('Nom différent du copropriétaire (locataire ?)');
    }
    return { owners, issues };
  }

  async function api(action, data) {
    await new Promise((r) => setTimeout(r, 120)); // latence réseau simulée
    const db = load();
    const s = db.session;
    switch (action) {
      case 'session':
        return ok({ csrf: 'demo', residence: 'Résidence de démonstration — Vincennes', contact: 'conseil.syndical@exemple.fr', lots: db.lots.map((l) => ({ numero: l.numero, libelle: l.libelle })),
          strict_lots: true, ocr: 'local', serial_min: SERIAL_MIN, serial_max: SERIAL_MAX, resident_email: s.resident, admin: s.admin,
          central: (db.central || []).some((r) => r.serial) });
      case 'suggest_badges': {
        const d = db.declarations.find((x) => x.id === Number(data.declaration_id));
        const own = d && (s.admin || (d.email && d.email === s.resident)) ? d.id : null;
        return ok({ suggestions: suggestions(data, own).map((x) => ({ token: x.token, hint: x.hint })) });
      }
      case 'check_serial': {
        const serial = normSerial(data.serial), e = serialError(serial);
        if (e) return ok({ serial, valid: false, message: e });
        const decl = db.declarations.find((d) => d.id === Number(data.declaration_id));
        const ignore = decl && (s.admin || (decl.email && decl.email === s.resident)) ? decl.id : null;
        const taken = serialTaken(serial, ignore);
        return ok({ serial, valid: !taken, message: taken ? 'Ce badge est déjà déclaré.' : null });
      }
      case 'submit': {
        if (!data.consent) return invalid({ consent: 'Merci de prendre connaissance de la notice et de cocher la case.' });
        const declId = Number(data.declaration_id) || null;
        if (declId) {
          const d = db.declarations.find((x) => x.id === declId);
          if (!d || d.email !== s.resident) return err('Vous ne pouvez pas modifier cette déclaration. Demandez un code de vérification.', 403);
        }
        const v = validateAll(data, declId, tokenMap(data, declId), false);
        if (v.errors) return invalid(v.errors);
        return ok({ declaration: publicDecl(saveDecl(declId, v.identity, v.badges, v.reports)) });
      }
      case 'request_code': {
        const email = clean(data.email, 160).toLowerCase();
        if (!isEmail(email)) return invalid({ email: "L'adresse email n'est pas valide." });
        let msg = `Si une déclaration est associée à ${email}, un code vient d'y être envoyé.`;
        if (db.declarations.some((d) => d.email === email)) {
          const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
          db.codes[email] = { code, exp: Date.now() + 900000, tries: 0 };
          save();
          msg += `\n\nDémo : aucun email n'est envoyé. Votre code est ${code}.`;
        } else {
          msg += '\n\nDémo : aucune déclaration avec cet email. Essayez exemple.dupont@exemple.fr, ou faites une déclaration en laissant votre email.';
        }
        return ok({ message: msg });
      }
      case 'verify_code': {
        const email = clean(data.email, 160).toLowerCase(), c = db.codes[email];
        if (!c || c.exp < Date.now()) return err('Code expiré ou inconnu. Demandez un nouveau code.', 400, { expired: true });
        if (c.tries >= 5) { delete db.codes[email]; save(); return err('Trop d’essais. Demandez un nouveau code.', 400, { expired: true }); }
        if (String(data.code) !== c.code) { c.tries++; save(); return err(`Code incorrect. Encore ${5 - c.tries} essai(s).`); }
        delete db.codes[email];
        s.resident = email; save();
        return ok({ email, declarations: db.declarations.filter((d) => d.email === email).map(publicDecl) });
      }
      case 'my_declarations':
        if (!s.resident) return err('Vérification par code requise.', 401);
        return ok({ email: s.resident, declarations: db.declarations.filter((d) => d.email === s.resident).map(publicDecl) });
      case 'delete_declaration': {
        const before = db.declarations.length;
        db.declarations = db.declarations.filter((d) => !(d.id === Number(data.id) && d.email === s.resident));
        if (db.declarations.length === before) return err('Déclaration introuvable.', 404);
        save(); return ok();
      }
      case 'resident_logout': s.resident = null; save(); return ok();
      case 'ocr': return ok({ mode: 'local' });
      case 'admin_login':
        if (data.password !== 'demo') return err('Mot de passe incorrect. (Démo : le mot de passe est « demo ».)', 401);
        s.admin = true; save(); return ok();
      case 'admin_logout': s.admin = false; save(); return ok();
    }
    if (!s.admin) return err('Connexion administrateur requise.', 401);
    switch (action) {
      case 'admin_list': {
        const idx = syndicIndex();
        const names = centralNames(), loaded = Object.keys(names).length > 0;
        const decls = copy(db.declarations).map((d) => {
          d.reports = (d.reports || []).map((r) => Object.assign(r, { central_names: names[r.serial] || [] }));
          d.badges.forEach((b) => { b.central_names = loaded ? names[b.serial] || [] : null; });
          return Object.assign(d, { syndic_check: syndicCheck(d, idx) });
        });
        return ok({ declarations: decls, lots_count: db.lots.length, owners_count: Object.keys(idx.byLogin).length });
      }
      case 'admin_save_declaration': {
        const id = Number(data.declaration_id) || null;
        const v = validateAll(data, id, null, true);
        if (v.errors) return invalid(v.errors);
        return ok({ declaration: copy(saveDecl(id, v.identity, v.badges, null)) });
      }
      case 'admin_delete_badge':
        db.declarations.forEach((d) => { d.badges = d.badges.filter((b) => b.id !== Number(data.id)); });
        db.declarations = db.declarations.filter((d) => d.badges.length || (d.reports || []).length);
        save(); return ok();
      case 'admin_matching_list':
        return ok({ rows: matchingRows(), owners: ownersIndex().map(pubOwner), central_loaded: (db.central || []).some((r) => r.serial) });
      case 'admin_match_decide': {
        db.matches = db.matches || {};
        if (data.action === 'reset') { delete db.matches[data.key]; save(); return ok(); }
        if (data.action === 'valider' && !db.lots.some((l) => l.owner_login === data.login)) return invalid({ owner: 'Choisissez un copropriétaire de la liste du syndic.' });
        if (!['valider', 'rejeter'].includes(data.action)) return err('Action de rapprochement inconnue.');
        db.matches[data.key] = { status: data.action === 'valider' ? 'valide' : 'rejete', owner_login: data.action === 'valider' ? data.login : null, decided_at: now() };
        save(); return ok();
      }
      case 'admin_match_bulk': {
        db.matches = db.matches || {}; let n = 0;
        matchingRows().forEach((r) => { if (r.level === 'sure' && !r.decision) { db.matches[r.key] = { status: 'valide', owner_login: r.candidates[0].login, decided_at: now() }; n++; } });
        save(); return ok({ count: n });
      }
      case 'admin_central_list': {
        const rows = centralRows(), known = new Set(rows.map((r) => r.serial).filter(Boolean));
        let outside = 0; db.declarations.forEach((d) => d.badges.forEach((b) => { if (!known.has(b.serial)) outside++; }));
        return ok({ rows, declared_outside: known.size ? outside : null, imported_at: rows.length ? db.central_imported_at : null });
      }
      case 'admin_import_central': {
        const rows = parseCentral(data.content);
        if (!rows.length) return err('Aucune ligne reconnue. Le fichier doit contenir les colonnes Nom, Identifiant et Code série (texte tabulé ou CSV).');
        const withSerial = rows.filter((r) => r.serial).length;
        if (!withSerial) return err('Aucun code série reconnu dans ce fichier. Vérifiez qu’il s’agit bien de l’export de la centrale.');
        db.central = rows; db.central_imported_at = now(); save();
        return ok({ count: rows.length, with_serial: withSerial });
      }
      case 'admin_delete_declaration':
        db.declarations = db.declarations.filter((d) => d.id !== Number(data.id)); save(); return ok();
      case 'admin_import_lots': {
        const list = parseLots(String(data.csv || ''));
        if (list === null) return err('Le fichier JSON est illisible.');
        if (!list.length) return err('Aucun numéro de lot reconnu. Fournissez l’export JSON du syndic, ou un CSV dont la première colonne contient les numéros de lot.');
        db.lots = list.sort((a, b) => a.numero - b.numero); save();
        return ok({ count: list.length, owners: new Set(list.map((l) => l.owner_login).filter(Boolean)).size });
      }
      case 'admin_clear_lots': db.lots = []; save(); return ok();
      case 'admin_lots_list': return ok({ rows: lotsRows() });
      case 'admin_lot_save': {
        const orig = data.original_numero ? String(Number(data.original_numero)) : '';
        const raw = clean(data.numero, 4), num = /^\d{1,4}$/.test(raw) && Number(raw) > 0 ? String(Number(raw)) : null;
        const login = clean(data.login, 20).toUpperCase(), last = clean(data.nom, 80).toUpperCase(), first = clean(data.prenom, 80);
        const errors = {};
        if (!num) errors.numero = 'Le numéro de lot comporte 1 à 4 chiffres (ex. 0102).';
        if (login && !/^[A-Z][0-9]{6}$/.test(login)) errors.login = "L'identifiant syndic est une lettre suivie de 6 chiffres (ex. C543210).";
        if (login && !last) errors.nom = 'Indiquez le nom du copropriétaire.';
        if (!Object.keys(errors).length && num !== orig && db.lots.some((l) => l.numero === num)) errors.numero = 'Ce numéro de lot existe déjà.';
        if (Object.keys(errors).length) return invalid(errors);
        const rec = Object.assign({ numero: num }, lotRecord(clean(data.libelle, 60) || null, last, first, login || null));
        db.lots = db.lots.filter((l) => l.numero !== orig && l.numero !== num).concat([rec]).sort((a, b) => a.numero - b.numero);
        let others = 0;
        if (login) db.lots.forEach((l) => { if (l.owner_login === login && l.numero !== num) { Object.assign(l, { owner_lastname: rec.owner_lastname, owner_firstname: rec.owner_firstname, owner_name: rec.owner_name }); others++; } });
        save(); return ok({ numero: num, others_updated: others });
      }
      case 'admin_lot_delete': {
        const n = String(Number(data.numero)); db.lots = db.lots.filter((l) => l.numero !== n); save(); return ok();
      }
      case 'admin_purge':
        if (data.confirm !== 'PURGER') return err('Tapez PURGER pour confirmer.');
        db.declarations = []; db.codes = {}; save(); return ok();
    }
    return err('Action inconnue.', 404);
  }

  /** Construit le CSV exactement comme le serveur */
  function buildCsv(ids) {
    const fmt = (s) => { if (!s) return ''; const [d, h] = s.split(' '); const [y, m, j] = d.split('-'); return `${j}/${m}/${y} ${h.slice(0, 5)}`; };
    const cell = (v) => {
      v = v == null ? '' : String(v);
      if (v && '=+-@\t\r'.includes(v[0])) v = "'" + v;
      return /[;"\n\r ]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const head = ['date_saisie', 'date_modification', 'lot', 'nom', 'identifiant_syndic', 'email_contact', 'numero_badge', 'escalier_A', 'escalier_B', 'escalier_C', 'telecommande_parking', 'occupant', 'locataire_nom', 'locataire_telephone', 'locataire_email', 'coproprietaire_selon_syndic', 'controle', 'centrale_actuelle'];
    const lines = [head.join(';')];
    const idx = syndicIndex(), names = centralNames(), loaded = Object.keys(names).length > 0;
    load().declarations.forEach((d) => { const chk = syndicCheck(d, idx); d.badges.forEach((b) => {
      if (ids.length && !ids.includes(b.id)) return;
      lines.push([fmt(b.created_at), fmt(b.updated_at), d.lot, d.nom, d.id_syndic, d.email, b.serial,
        b.stair_a ? 'oui' : 'non', b.stair_b ? 'oui' : 'non', b.stair_c ? 'oui' : 'non', b.parking ? 'oui' : 'non',
        b.occupant === 'locataire' ? 'locataire' : 'copropriétaire', b.tenant_name, b.tenant_phone, b.tenant_email,
        chk ? chk.owners.map((o) => `${o.name} (${o.login})`).join(' / ') : '',
        chk === null ? '' : chk.issues.length ? 'À vérifier : ' + chk.issues.join(', ') : 'OK',
        loaded ? (names[b.serial] ? names[b.serial].join(' / ') : 'absent') : ''].map(cell).join(';'));
    }); });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  const STATUS_LABELS = { declare: 'Déclaré', perdu: 'Plus en possession', pas_a_moi: 'Refusé par le résident', non_declare: 'Non déclaré', sans_numero: 'Sans numéro de série' };
  function buildCentralCsv(ids) {
    const fmt = (s) => { if (!s) return ''; const [d, h] = s.split(' '); const [y, m, j] = d.split('-'); return `${j}/${m}/${y} ${h.slice(0, 5)}`; };
    const cell = (v) => { v = v == null ? '' : String(v); if (v && '=+-@'.includes(v[0])) v = "'" + v; return /[;"\n\r ]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = ['nom;identifiant;code_serie;statut;detail;date_reponse;doublon;rapprochement;coproprietaire;identifiant_syndic;lots'];
    const owners = Object.fromEntries(ownersIndex().map((o) => [o.login, o]));
    centralRows().forEach((r) => {
      if (ids.length && !ids.includes(r.id)) return;
      const m = r.match, o = m && m.login ? owners[m.login] : null;
      lines.push([r.name, r.identifiant, r.raw_serial, STATUS_LABELS[r.status], r.detail, fmt(r.date), r.duplicate ? 'oui' : '',
        !m ? '' : m.status === 'valide' ? 'validé' : 'aucun copropriétaire', o ? o.name : '', m ? m.login || '' : '', o ? o.lots.map((l) => l.numero).join(', ') : ''].map(cell).join(';'));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }
  async function offerCsv(csv, prefix) {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const filename = `${prefix}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`;
    let downloads = null;
    try { downloads = window.claude ? await window.claude.use('downloads') : null; } catch (e) { downloads = null; }
    if (downloads) {
      try { await downloads.save({ filename, data: new Blob([csv], { type: 'text/csv;charset=utf-8' }) }); return; } catch (e) { /* refusé : on affiche le contenu */ }
    }
    window.App.showCsvPreview(csv.replace(/^\uFEFF/, ''), filename);
  }
  window.MOCK_CENTRAL_EXPORT = (ids) => offerCsv(buildCentralCsv(ids), 'centrale_badges');
  function lotsRows() {
    return load().lots.slice().sort((a, b) => a.numero - b.numero).map((l) => ({ numero: String(l.numero).padStart(4, '0'), libelle: l.libelle, nom: l.owner_lastname, prenom: l.owner_firstname, login: l.owner_login }));
  }
  window.MOCK_LOTS_EXPORT = function () {
    const cell = (v) => { v = v == null ? '' : String(v); return /[;"\n\r ]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = ['numero;type;nom;prenom;identifiant_syndic'].concat(lotsRows().map((r) => [r.numero, r.libelle, r.nom, r.prenom, r.login].map(cell).join(';')));
    return offerCsv('\uFEFF' + lines.join('\r\n') + '\r\n', 'lots');
  };

  window.MOCK_API = api;
  window.DEMO_RESET = function () { mem = seed(); save(); };

  /* Export : passe par la capacité « downloads » quand elle est disponible, sinon affiche le CSV */
  window.MOCK_EXPORT = async function (ids) {
    const csv = buildCsv(ids);
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const filename = `badges_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`;
    let downloads = null;
    try { downloads = window.claude ? await window.claude.use('downloads') : null; } catch (e) { downloads = null; }
    if (downloads) {
      try { await downloads.save({ filename, data: new Blob([csv], { type: 'text/csv;charset=utf-8' }) }); return; } catch (e) { /* refusé : on affiche le contenu */ }
    }
    window.App.showCsvPreview(csv.replace(/^﻿/, ''), filename);
  };

  /* Lecture photo : Claude via la capacité « sample » (images), sinon Tesseract.js */
  window.DEMO_OCR = async function (dataUrl) {
    let sample = null;
    try { sample = window.claude ? await window.claude.use('sample') : null; } catch (e) { sample = null; }
    if (!sample) return null;
    const blob = await (await fetch(dataUrl)).blob();
    const prompt = 'Cette photo montre un badge d\'accès d\'immeuble (badge Vigik, porte-clés RFID ou carte). ' +
      'Repère le numéro de série imprimé ou gravé : une suite de caractères hexadécimaux (0-9, A-F), souvent 6 à 16 caractères, parfois découpée par des espaces ou des tirets. ' +
      'Ignore marques, logos, numéros de téléphone et dates. Corrige les confusions O→0, I→1. ' +
      'Réponds uniquement en JSON : {"serial": "<numéro le plus probable, sans espaces, majuscules, ou vide>", "candidates": ["<autres suites hexadécimales visibles>"], "confidence": "high" | "medium" | "low"}';
    try {
      const j = await sample.json(prompt, { images: [blob], modelTier: 'quick' });
      const ok = (v) => { const n = normSerial(v); return serialError(n) ? '' : n; };
      let serial = ok(j && j.serial);
      const cands = [...new Set(((j && j.candidates) || []).map(ok).filter((c) => c && c !== serial))];
      if (!serial && cands.length) serial = cands.shift();
      return { serial, candidates: cands.slice(0, 4), confidence: serial ? (j.confidence || 'medium') : 'low', mode: 'server' };
    } catch (e) {
      if (e && e.code === 'not_granted') return null; // refus : lecture locale
      throw new Error('Lecture par Claude impossible pour le moment.');
    }
  };
})();

/* Aperçu du CSV quand le téléchargement n'est pas possible dans la démo */
(function () {
  window.App.showCsvPreview = function (csv, filename) {
    let dlg = document.getElementById('csv-dialog');
    if (!dlg) {
      document.body.insertAdjacentHTML('beforeend', `
<dialog id="csv-dialog" aria-labelledby="csv-title">
  <div class="dlg">
    <div class="dlg-head"><h2 id="csv-title">Export CSV</h2><button type="button" class="icon-btn" id="csv-close" aria-label="Fermer">&times;</button></div>
    <div class="dlg-body">
      <p class="hint" style="margin:0 0 10px" id="csv-name"></p>
      <textarea id="csv-text" rows="12" class="mono" readonly style="text-transform:none;letter-spacing:0;font-size:12.5px;white-space:pre;overflow:auto"></textarea>
    </div>
    <div class="dlg-foot"><button type="button" class="btn btn-primary" id="csv-copy">Copier le contenu</button></div>
  </div>
</dialog>`);
      dlg = document.getElementById('csv-dialog');
      document.getElementById('csv-close').onclick = () => dlg.close();
      document.getElementById('csv-copy').onclick = async () => {
        const ta = document.getElementById('csv-text');
        try { await navigator.clipboard.writeText(ta.value); window.App.toast('Contenu copié'); }
        catch (e) { ta.focus(); ta.select(); window.App.toast('Sélectionné : copiez avec Ctrl+C / Cmd+C'); }
      };
    }
    document.getElementById('csv-name').textContent = `Le téléchargement n'est pas disponible ici. Voici le contenu exact de ${filename} (séparateur ;, UTF-8 avec BOM) :`;
    document.getElementById('csv-text').value = csv;
    dlg.showModal();
  };
})();
