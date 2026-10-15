/* Page administrateur */
(function () {
  'use strict';
  const App = window.App;
  const $ = (id) => document.getElementById(id);

  const state = { declarations: [], rows: [], filtered: [], lotsCount: 0, edit: null };

  function show(view) {
    $('view-login').hidden = view !== 'login';
    $('view-dash').hidden = view !== 'dash';
    $('btn-logout').hidden = view !== 'dash';
  }

  document.querySelectorAll('dialog').forEach((d) => {
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  });

  /* ------------------------------------------------------------ Login */
  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').hidden = true;
    const r = await App.api('admin_login', { password: $('in-password').value });
    if (!r.ok) { $('login-error').textContent = r.error; $('login-error').hidden = false; return; }
    $('in-password').value = '';
    await App.loadSession();
    await refresh();
    show('dash');
    loadCentralCount();
  });

  $('btn-logout').addEventListener('click', async () => {
    await App.api('admin_logout');
    show('login');
  });

  /* ------------------------------------------------------------ Data */
  async function refresh() {
    const r = await App.api('admin_list');
    if (!r.ok) {
      if (r.status === 401) { show('login'); return; }
      App.toast(r.error); return;
    }
    state.declarations = r.declarations;
    state.lotsCount = r.lots_count;
    state.rows = [];
    r.declarations.forEach((d) => {
      d.badges.forEach((b) => state.rows.push({ d, b }));
      if (!d.badges.length) state.rows.push({ d, b: null }); // déclaration avec seulement des réponses (ex. badge perdu)
    });
    renderStats();
    applyFilters();
    state.ownersCount = r.owners_count || 0;
    const toVerify = r.declarations.filter((d) => d.syndic_check && d.syndic_check.issues.length).length;
    $('lots-status').textContent = !state.lotsCount
      ? 'Aucune liste de lots chargée : les numéros de lot ne sont pas contrôlés.'
      : state.ownersCount
        ? `${state.lotsCount} lots et ${state.ownersCount} copropriétaires chargés depuis la liste du syndic. ${toVerify} déclaration(s) à vérifier.`
        : `${state.lotsCount} lots chargés : les numéros de lot saisis sont contrôlés.`;
    $('f-check').hidden = !state.ownersCount;
  }

  function renderStats() {
    const rows = state.rows.filter((r) => r.b);
    const count = (f) => rows.filter(f).length;
    const items = [
      [state.declarations.length, 'déclarations'],
      [rows.length, 'badges'],
      [count((r) => r.b.stair_a), 'escalier A'],
      [count((r) => r.b.stair_b), 'escalier B'],
      [count((r) => r.b.stair_c), 'escalier C'],
      [count((r) => r.b.parking), 'télécommandes parking'],
      [count((r) => r.b.occupant === 'locataire'), 'pour locataires'],
    ];
    $('stats').innerHTML = items.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  }

  function applyFilters() {
    const q = $('q').value.trim().toLowerCase();
    const qSerial = App.normalizeSerial(q);
    const stair = $('f-stair').value, occ = $('f-occ').value, chk = $('f-check').value;
    state.filtered = state.rows.filter(({ d, b }) => {
      if ((stair || occ) && !b) return false;
      if (stair && !(stair === 'parking' ? b.parking : b['stair_' + stair])) return false;
      if (occ && b.occupant !== occ) return false;
      if (chk) {
        if (!d.syndic_check) return false;
        if (chk === 'verify' && !d.syndic_check.issues.length) return false;
        if (chk === 'ok' && d.syndic_check.issues.length) return false;
      }
      if (!q) return true;
      const hay = [d.lot, d.nom, d.id_syndic, d.email, b && b.tenant_name, b && b.tenant_phone, b && b.tenant_email, ...(b && b.central_names || [])].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q) || (qSerial && b && b.serial.includes(qSerial)) || (d.lot && String(Number(d.lot)) === String(Number(q)));
    });
    renderRows();
  }
  ['q', 'f-stair', 'f-occ', 'f-check'].forEach((id) => $(id).addEventListener('input', applyFilters));

  function checkCell(d) {
    const c = d.syndic_check, e = App.esc;
    if (!c) return '';
    const roles = c.owners.length > 1 ? ['Lot : ', 'Identifiant : '] : ['', ''];
    const owners = c.owners.map((o, i) => `<span class="small">${roles[i] || ''}</span>${e(o.name)} <span class="small mono">${e(o.login)}</span>`).join('<br>');
    const tag = c.issues.length
      ? `<span class="tag warn" title="${e(c.issues.join(' · '))}">À vérifier</span><div class="small">${c.issues.map(e).join('<br>')}</div>`
      : '<span class="tag green">Conforme</span>';
    return `<div>${owners || '<span class="small">—</span>'}<div>${tag}</div></div>`;
  }

  function fmt(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T'));
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderRows() {
    const e = App.esc;
    const filtering = $('q').value || $('f-stair').value || $('f-occ').value || $('f-check').value;
    const nb = (list) => list.filter((r) => r.b).length;
    $('result-count').textContent = filtering
      ? `${nb(state.filtered)} badge(s) sur ${nb(state.rows)} — l'export ne contiendra que ces badges.`
      : `${nb(state.rows)} badge(s).`;
    $('rows-empty').hidden = state.filtered.length > 0;
    $('rows').innerHTML = state.filtered.map(({ d, b }) => b ? `
      <tr data-decl="${d.id}" data-badge="${b.id}">
        <td data-label="Lot">${d.lot ? e(String(d.lot).padStart(4, '0')) : '<span class="small">—</span>'}</td>
        <td data-label="Nom">${e(d.nom) || '<span class="small">—</span>'}</td>
        <td data-label="Id. syndic" class="mono">${e(d.id_syndic) || '<span class="small">—</span>'}</td>
        <td data-label="N° de badge"><span class="serial">${e(b.serial)}</span>${centralTag(b)}${d.badges[0] === b && (d.reports || []).length ? `<div class="reports-inline"><span class="small">Réponses aux badges proposés :</span>${reportsSummary(d)}</div>` : ''}</td>
        <td data-label="Accès">${App.esc(App.accessLabel(b))}</td>
        <td data-label="Occupant">${App.occupantLabel(b.occupant)}</td>
        <td data-label="Locataire">${b.occupant === 'locataire' ? [b.tenant_name, b.tenant_phone, b.tenant_email].filter(Boolean).map(e).join('<br>') || '<span class="small">non renseigné</span>' : ''}</td>
        <td data-label="Contact">${d.email ? `<a href="mailto:${e(d.email)}">${e(d.email)}</a>` : '<span class="small">—</span>'}</td>
        <td data-label="Selon le syndic" class="check-cell">${checkCell(d)}</td>
        <td data-label="Saisi le" class="small">${e(fmt(b.created_at))}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="edit">Modifier</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="del" style="color:var(--danger)">Supprimer</button>
        </td>
      </tr>` : `
      <tr data-decl="${d.id}" data-badge="">
        <td data-label="Lot">${d.lot ? e(String(d.lot).padStart(4, '0')) : '<span class="small">—</span>'}</td>
        <td data-label="Nom">${e(d.nom) || '<span class="small">—</span>'}</td>
        <td data-label="Id. syndic" class="mono">${e(d.id_syndic) || '<span class="small">—</span>'}</td>
        <td data-label="N° de badge" colspan="5"><span class="small">Aucun badge déclaré.</span> ${reportsSummary(d)}</td>
        <td data-label="Selon le syndic" class="check-cell">${checkCell(d)}</td>
        <td data-label="Saisi le" class="small">${e(fmt(d.created_at))}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="edit">Modifier</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="del-decl" style="color:var(--danger)">Supprimer</button>
        </td>
      </tr>`).join('');
  }

  const REPORT_LABELS = { perdu: 'plus en possession', pas_a_moi: 'pas à ce résident' };
  function centralTag(b) {
    if (!Array.isArray(b.central_names)) return '';
    return b.central_names.length
      ? `<div><span class="tag sand">Centrale : ${App.esc(b.central_names.join(' / '))}</span></div>`
      : '<div><span class="tag warn">Absent de la centrale</span></div>';
  }
  function reportsSummary(d) {
    return (d.reports || []).map((r) => `<div class="small"><span class="mono">${App.esc(r.serial)}</span> (${App.esc((r.central_names || []).join(' / ') || '?')}) : ${REPORT_LABELS[r.answer]}</div>`).join('');
  }

  $('rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const declId = Number(tr.dataset.decl), badgeId = Number(tr.dataset.badge);
    if (btn.dataset.act === 'edit') return openDecl(state.declarations.find((d) => d.id === declId));
    if (btn.dataset.act === 'del-decl') {
      if (!(await App.confirm('Supprimer cette déclaration et ses réponses ?'))) return;
      const r = await App.api('admin_delete_declaration', { id: declId });
      if (!r.ok) return App.toast(r.error);
      App.toast('Déclaration supprimée');
      return refresh();
    }
    const row = state.rows.find((r) => r.b && r.b.id === badgeId);
    const last = row.d.badges.length === 1 && !(row.d.reports || []).length;
    if (!(await App.confirm(`Supprimer le badge ${row.b.serial} ?${last ? '\nC’est le dernier badge de cette déclaration : elle sera supprimée aussi.' : ''}`))) return;
    const r = await App.api('admin_delete_badge', { id: badgeId });
    if (!r.ok) return App.toast(r.error);
    App.toast('Badge supprimé');
    refresh();
  });

  /* ------------------------------------------------------------ Export */
  $('btn-export').addEventListener('click', () => {
    const filtering = $('q').value || $('f-stair').value || $('f-occ').value || $('f-check').value;
    const ids = filtering ? state.filtered.filter((r) => r.b).map((r) => r.b.id) : [];
    if (filtering && !ids.length) return App.toast('Aucun badge à exporter avec ces filtres.');
    if (window.MOCK_EXPORT) return window.MOCK_EXPORT(ids);
    const url = `${window.API_URL}?action=admin_export&csrf=${encodeURIComponent(App.csrf)}${ids.length ? '&ids=' + ids.join(',') : ''}`;
    window.location.href = url;
  });

  /* ------------------------------------------------------------ Declaration editor */
  const dForm = $('decl-form');

  function renderDeclBadges() {
    $('decl-badges').innerHTML = state.edit.badges.map((b, i) => App.badgeCardHTML(b, i, state.edit.errors[i])).join('');
  }

  function openDecl(decl) {
    state.edit = { id: decl ? decl.id : null, badges: decl ? decl.badges.map((b) => ({ ...b })) : [], errors: {} };
    dForm.reset();
    ['d-identity', 'd-lot', 'd-nom', 'd-id_syndic', 'd-email', 'd-badges'].forEach((id) => App.setFieldError($(id), null));
    $('decl-error').hidden = true;
    $('decl-title').textContent = decl ? 'Modifier la déclaration' : 'Nouvelle déclaration';
    $('decl-delete').hidden = !decl;
    if (decl) {
      dForm.lot.value = decl.lot || ''; dForm.nom.value = decl.nom || '';
      dForm.id_syndic.value = decl.id_syndic || ''; dForm.email.value = decl.email || '';
    }
    renderDeclBadges();
    const reports = decl ? decl.reports || [] : [];
    $('d-reports').hidden = !reports.length;
    $('decl-reports').innerHTML = reports.map((r) => `<li><span class="mono">${App.esc(r.serial)}</span> (${App.esc((r.central_names || []).join(' / ') || 'nom inconnu')}) : ${REPORT_LABELS[r.answer]}</li>`).join('');
    $('decl-dialog').showModal();
  }
  $('btn-new-decl').addEventListener('click', () => openDecl(null));

  async function editDeclBadge(i) {
    const isNew = i == null;
    const dlg = $('decl-dialog');
    dlg.close(); // une seule fenêtre modale à la fois
    const res = await App.BadgeDialog.open({
      badge: isNew ? null : state.edit.badges[i],
      otherSerials: state.edit.badges.filter((_, j) => j !== i).map((b) => b.serial),
      declarationId: state.edit.id,
      serverError: isNew ? null : state.edit.errors[i],
    });
    if (res) {
      if (isNew) state.edit.badges.push(res); else { state.edit.badges[i] = res; delete state.edit.errors[i]; }
      renderDeclBadges();
    }
    dlg.showModal();
  }
  $('decl-add').addEventListener('click', () => editDeclBadge(null));
  $('decl-badges').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = Number(btn.closest('.badge-card').dataset.index);
    if (btn.dataset.act === 'edit') return editDeclBadge(i);
    state.edit.badges.splice(i, 1);
    state.edit.errors = {};
    renderDeclBadges();
  });

  dForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('decl-error').hidden = true;
    ['d-identity', 'd-lot', 'd-nom', 'd-id_syndic', 'd-email', 'd-badges'].forEach((id) => App.setFieldError($(id), null));
    const r = await App.api('admin_save_declaration', {
      declaration_id: state.edit.id || 0,
      lot: dForm.lot.value.trim(), nom: dForm.nom.value.trim(), id_syndic: dForm.id_syndic.value.trim(), email: dForm.email.value.trim(),
      badges: state.edit.badges,
    });
    if (!r.ok) {
      const errs = r.errors || {};
      Object.entries({ identity: 'd-identity', lot: 'd-lot', nom: 'd-nom', id_syndic: 'd-id_syndic', email: 'd-email', badges: 'd-badges' })
        .forEach(([k, id]) => { if (errs[k]) App.setFieldError($(id), errs[k]); });
      if (errs.badges_detail) { state.edit.errors = errs.badges_detail; renderDeclBadges(); }
      $('decl-error').textContent = r.error; $('decl-error').hidden = false;
      return;
    }
    $('decl-dialog').close();
    App.toast('Déclaration enregistrée');
    refresh();
  });

  $('decl-delete').addEventListener('click', async () => {
    if (!(await App.confirm('Supprimer cette déclaration et tous ses badges ?'))) return;
    const r = await App.api('admin_delete_declaration', { id: state.edit.id });
    if (!r.ok) return App.toast(r.error);
    $('decl-dialog').close();
    App.toast('Déclaration supprimée');
    refresh();
  });

  /* ------------------------------------------------------------ Lots */
  document.querySelectorAll('[data-open-lots-import]').forEach((b) => b.addEventListener('click', () => {
    $('lots-form').reset();
    $('lots-error').hidden = true;
    $('lots-current').textContent = state.lotsCount ? `${state.lotsCount} lots actuellement chargés.` : 'Aucune liste chargée pour l’instant.';
    $('lots-dialog').showModal();
  }));
  $('lots-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) $('lots-text').value = await App.readTextFile(f);
  });

  /* ------------------------------------------------------------ Onglets */
  function showTab(name) {
    ['decl', 'central', 'lots', 'match'].forEach((t) => {
      $('tab-' + t).hidden = t !== name;
      $('tab-btn-' + t).setAttribute('aria-selected', String(t === name));
    });
    if (name === 'central') loadCentral();
    if (name === 'match') loadMatching();
    if (name === 'lots') loadLots();
  }
  $('tab-btn-lots').addEventListener('click', () => showTab('lots'));

  /* ------------------------------------------------------------ Lots et copropriétaires */
  state.lots = { rows: [], filtered: [], view: 'owner' };
  try { const v = localStorage.getItem('badges-lots-view'); if (['owner', 'login', 'flat'].includes(v)) state.lots.view = v; } catch (e) { /* stockage indisponible */ }

  async function loadLots() {
    const r = await App.api('admin_lots_list');
    if (!r.ok) { if (r.status === 401) show('login'); else App.toast(r.error); return; }
    state.lots.rows = r.rows;
    state.lotsCount = r.rows.length;
    $('lots-count').textContent = r.rows.length ? `(${r.rows.length})` : '';
    $('lots-empty').hidden = r.rows.length > 0;
    $('lots-main').hidden = !r.rows.length;
    const types = [...new Set(r.rows.map((x) => x.libelle).filter(Boolean))].sort();
    const cur = $('l-type').value;
    $('l-type').innerHTML = '<option value="">Tous types</option>' + types.map((t) => `<option value="${App.esc(t)}">${App.esc(t)}</option>`).join('') + '<option value="__none">Sans copropriétaire</option>';
    $('l-type').value = cur;
    $('lot-types').innerHTML = types.map((t) => `<option value="${App.esc(t)}"></option>`).join('');
    const owners = lotOwners();
    $('lot-logins').innerHTML = Object.values(owners).map((o) => `<option value="${App.esc(o.login)}">${App.esc([o.nom, o.prenom].filter(Boolean).join(' '))}</option>`).join('');
    const n = (f) => r.rows.filter(f).length;
    const items = [
      [r.rows.length, 'lots'],
      [Object.keys(owners).length, 'copropriétaires'],
      [n((x) => x.libelle === 'Appartement' || x.libelle === 'Studio'), 'logements'],
      [Object.values(owners).filter((o) => !o.prenom).length, 'copropriétaires sans prénom'],
      [n((x) => !x.login), 'sans copropriétaire'],
      [declaredLots().size, 'lots déclarés'],
    ];
    $('lots-stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    filterLots();
  }

  /** Copropriétaires par identifiant, avec leurs lots */
  function lotOwners() {
    const m = {};
    state.lots.rows.forEach((x) => {
      if (!x.login) return;
      (m[x.login] = m[x.login] || { login: x.login, nom: x.nom, prenom: x.prenom, lots: [] }).lots.push(x.numero);
    });
    return m;
  }
  function declaredLots() {
    const m = new Map();
    state.declarations.forEach((d) => { if (d.lot) m.set(String(Number(d.lot)), (m.get(String(Number(d.lot))) || 0) + 1); });
    return m;
  }

  function filterLots() {
    const q = $('lq').value.trim().toLowerCase(), t = $('l-type').value;
    const decl = declaredLots();
    state.lots.filtered = state.lots.rows.filter((x) => {
      if (t === '__none' ? x.login : t && x.libelle !== t) return false;
      if (!q) return true;
      return [x.numero, String(Number(x.numero)), x.libelle, x.nom, x.prenom, x.login].join(' ').toLowerCase().includes(q);
    });
    renderLots(decl);
  }

  const lotDeclCount = (decl, x) => decl.get(String(Number(x.numero))) || 0;

  function renderLots(decl) {
    const e = App.esc, list = state.lots.filtered, view = state.lots.view;
    document.querySelectorAll('.seg [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    $('lots-rows-empty').hidden = list.length > 0;
    $('lots-table-wrap').hidden = view !== 'flat' || !list.length;
    $('lots-groups').hidden = view === 'flat';
    const filtering = $('lq').value.trim() || $('l-type').value;
    if (view === 'flat') {
      $('lots-groups').innerHTML = '';
      $('lots-result').textContent = filtering ? `${list.length} lot(s) sur ${state.lots.rows.length}.` : `${list.length} lot(s).`;
      $('lots-rows').innerHTML = list.map((x) => {
        const nd = lotDeclCount(decl, x);
        return `<tr data-numero="${e(x.numero)}">
          <td data-label="Lot" class="mono">${e(x.numero)}</td>
          <td data-label="Type">${e(x.libelle) || '<span class="small">—</span>'}</td>
          <td data-label="Nom">${e(x.nom) || '<span class="small">—</span>'}</td>
          <td data-label="Prénom">${e(x.prenom) || '<span class="small">—</span>'}</td>
          <td data-label="Identifiant" class="mono">${e(x.login) || '<span class="small">—</span>'}</td>
          <td data-label="Déclarations">${nd ? `<span class="tag green">${nd}</span>` : '<span class="small">aucune</span>'}</td>
          <td class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="edit">Modifier</button></td>
        </tr>`;
      }).join('');
      return;
    }
    $('lots-rows').innerHTML = '';
    // Regroupement : par personne (nom + prénom, plusieurs identifiants possibles) ou par identifiant syndic
    const groups = new Map();
    list.forEach((x) => {
      const fullName = [x.nom, x.prenom].filter(Boolean).join(' ');
      const key = !x.login ? '~sans' : view === 'owner' ? (fullName || x.login).toUpperCase() : x.login;
      if (!groups.has(key)) groups.set(key, { key, nom: x.nom, prenom: x.prenom, logins: new Set(), lots: [] });
      const g = groups.get(key);
      if (x.login) g.logins.add(x.login);
      g.lots.push(x);
    });
    const sorted = [...groups.values()].sort((a, b) => (a.key === '~sans') - (b.key === '~sans') || String(a.nom || '').localeCompare(String(b.nom || '')) || String(a.prenom || '').localeCompare(String(b.prenom || '')));
    const nOwners = sorted.filter((g) => g.key !== '~sans').length;
    const unit = view === 'owner' ? 'copropriétaire(s)' : 'identifiant(s) syndic';
    $('lots-result').textContent = `${nOwners} ${unit}, ${list.length} lot(s)${filtering ? ` sur ${state.lots.rows.length}` : ''}.`;
    $('lots-groups').innerHTML = sorted.map((g) => {
      const sans = g.key === '~sans';
      const types = {};
      g.lots.forEach((x) => { const t = (x.libelle || 'Autre').toLowerCase(); types[t] = (types[t] || 0) + 1; });
      const summary = Object.entries(types).map(([t, n]) => `${n} ${t}${n > 1 && !/[sx]$/.test(t) ? 's' : ''}`).join(', ');
      const nd = g.lots.reduce((s, x) => s + lotDeclCount(decl, x), 0);
      const logins = [...g.logins].sort();
      const head = sans
        ? '<strong>Lots sans copropriétaire</strong>'
        : `<strong>${e(g.nom || '')}</strong>${g.prenom ? ` <span class="owner-first">${e(g.prenom)}</span>` : ''}`;
      return `<section class="owner-group${sans ? ' is-orphan' : ''}">
        <header class="owner-head">
          <div class="owner-name">${head}
            ${logins.length ? `<div class="owner-logins">${logins.map((l) => `<span class="mono">${e(l)}</span>`).join(' ')}${logins.length > 1 ? ' <span class="tag sand">plusieurs identifiants</span>' : ''}</div>` : ''}
          </div>
          <div class="owner-meta">
            <span><b>${g.lots.length}</b> lot${g.lots.length > 1 ? 's' : ''}</span>
            <span class="small">${e(summary)}</span>
            ${nd ? `<span class="tag green">${nd} déclaration${nd > 1 ? 's' : ''}</span>` : '<span class="small">aucune déclaration</span>'}
          </div>
        </header>
        <div class="owner-lots">${g.lots.map((x) => {
          const d = lotDeclCount(decl, x);
          return `<button type="button" class="lot-chip${d ? ' declared' : ''}" data-numero="${e(x.numero)}" title="Modifier le lot ${e(x.numero)}${view === 'owner' && logins.length > 1 ? ' (' + e(x.login) + ')' : ''}">
            <span class="mono">${e(x.numero)}</span> ${e(x.libelle || '')}${d ? ' <span class="lot-dot" aria-label="déclaré"></span>' : ''}</button>`;
        }).join('')}</div>
      </section>`;
    }).join('');
  }

  document.querySelectorAll('.seg [data-view]').forEach((b) => b.addEventListener('click', () => {
    state.lots.view = b.dataset.view;
    try { localStorage.setItem('badges-lots-view', state.lots.view); } catch (e) { /* stockage indisponible */ }
    renderLots(declaredLots());
  }));
  $('lots-groups').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.lot-chip');
    if (chip) openLot(state.lots.rows.find((x) => x.numero === chip.dataset.numero));
  });
  ['lq', 'l-type'].forEach((id) => $(id).addEventListener('input', filterLots));

  const lotForm = $('lot-form');
  let editingLot = null;
  function lotFieldsReset() {
    ['lf-numero', 'lf-login', 'lf-nom', 'lf-libelle'].forEach((id) => App.setFieldError($(id), null));
    $('lot-error').hidden = true;
  }
  function openLot(x) {
    editingLot = x;
    lotForm.reset();
    lotFieldsReset();
    $('lot-title').textContent = x ? `Lot ${x.numero}` : 'Nouveau lot';
    $('lot-delete').hidden = !x;
    if (x) {
      lotForm.numero.value = x.numero; lotForm.libelle.value = x.libelle || '';
      lotForm.login.value = x.login || ''; lotForm.nom.value = x.nom || ''; lotForm.prenom.value = x.prenom || '';
    }
    updatePropagate();
    $('lot-dialog').showModal();
  }
  function updatePropagate() {
    const login = lotForm.login.value.trim().toUpperCase();
    const o = lotOwners()[login];
    const others = o ? o.lots.filter((n) => !editingLot || n !== editingLot.numero) : [];
    $('lt-propagate').hidden = !others.length;
    $('lt-propagate').textContent = others.length
      ? `Ce copropriétaire a aussi ${others.length > 1 ? 'les lots' : 'le lot'} ${others.join(', ')} : le nom et le prénom y seront mis à jour.` : '';
  }
  lotForm.login.addEventListener('input', () => {
    lotForm.login.value = lotForm.login.value.toUpperCase().replace(/\s/g, '');
    const o = lotOwners()[lotForm.login.value];
    if (o) { lotForm.nom.value = o.nom || ''; lotForm.prenom.value = o.prenom || ''; }
    updatePropagate();
  });
  document.querySelectorAll('[data-add-lot]').forEach((b) => b.addEventListener('click', () => openLot(null)));
  $('lots-rows').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act=edit]');
    if (!btn) return;
    openLot(state.lots.rows.find((x) => x.numero === btn.closest('tr').dataset.numero));
  });
  lotForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    lotFieldsReset();
    const r = await App.api('admin_lot_save', {
      original_numero: editingLot ? editingLot.numero : '',
      numero: lotForm.numero.value.trim(), libelle: lotForm.libelle.value.trim(),
      login: lotForm.login.value.trim(), nom: lotForm.nom.value.trim(), prenom: lotForm.prenom.value.trim(),
    });
    if (!r.ok) {
      const errs = r.errors || {};
      Object.entries({ numero: 'lf-numero', login: 'lf-login', nom: 'lf-nom' }).forEach(([k, id]) => { if (errs[k]) App.setFieldError($(id), errs[k]); });
      $('lot-error').textContent = r.error; $('lot-error').hidden = false;
      return;
    }
    $('lot-dialog').close();
    App.toast(r.others_updated ? `Lot enregistré, nom mis à jour sur ${r.others_updated} autre(s) lot(s)` : 'Lot enregistré');
    await loadLots();
    refresh();
  });
  $('lot-delete').addEventListener('click', async () => {
    $('lot-dialog').close();
    if (!(await App.confirm(`Supprimer le lot ${editingLot.numero} ?\nLes déclarations qui citent ce lot seront signalées « lot inconnu ».`))) return;
    const r = await App.api('admin_lot_delete', { numero: editingLot.numero });
    if (!r.ok) return App.toast(r.error);
    App.toast('Lot supprimé');
    await loadLots();
    refresh();
  });
  $('btn-lots-export').addEventListener('click', () => {
    if (window.MOCK_LOTS_EXPORT) return window.MOCK_LOTS_EXPORT();
    window.location.href = `${window.API_URL}?action=admin_lots_export&csrf=${encodeURIComponent(App.csrf)}`;
  });
  $('tab-btn-match').addEventListener('click', () => showTab('match'));

  /* ------------------------------------------------------------ Rapprochement centrale / syndic */
  const LEVELS = { sure: ['Sûr', 'green'], probable: ['Probable', 'sand'], faible: ['Faible', 'warn'], aucune: ['Aucune proposition', 'muted-tag'] };
  state.match = { rows: [], owners: [], filtered: [], choice: {} }; // choice : sélection en cours, par ligne
  const lotsText = (lots) => (lots || []).map((l) => `${l.numero}${l.libelle ? ' ' + l.libelle.toLowerCase() : ''}`).join(', ');
  const ownerLabel = (o) => `${o.name || '(introuvable)'} — ${o.login}${o.lots && o.lots.length ? ' — lots ' + o.lots.map((l) => l.numero).join(', ') : ''}`;

  async function loadMatching() {
    const r = await App.api('admin_matching_list');
    if (!r.ok) { if (r.status === 401) show('login'); else App.toast(r.error); return; }
    state.match.rows = r.rows;
    state.match.owners = r.owners;
    const missing = !r.central_loaded ? 'Importez d’abord la liste de la centrale (onglet « Centrale actuelle »).'
      : !r.owners.length ? 'Importez d’abord l’export JSON du syndic (bouton « Liste des lots », en bas de page).' : '';
    $('match-empty').hidden = !missing;
    $('match-main').hidden = !!missing;
    $('match-empty-msg').textContent = missing;
    updateMatchCount();
    if (missing) return;
    const rows = r.rows, n = (f) => rows.filter(f).length;
    const items = [
      [rows.length, 'noms dans la centrale'],
      [n((x) => !x.decision && x.level !== 'aucune'), 'propositions à valider'],
      [n((x) => !x.decision && x.level === 'sure'), 'dont sûres'],
      [n((x) => x.decision && x.decision.status === 'valide'), 'validés'],
      [n((x) => x.decision && x.decision.status === 'rejete'), 'aucun copropriétaire'],
      [n((x) => !x.decision && x.level === 'aucune'), 'sans proposition'],
    ];
    $('match-stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    const sure = n((x) => !x.decision && x.level === 'sure');
    $('btn-match-bulk').disabled = !sure;
    $('btn-match-bulk').textContent = sure ? `Valider les ${sure} correspondances sûres` : 'Aucune correspondance sûre en attente';
    filterMatching();
  }

  function updateMatchCount() {
    const todo = state.match.rows.filter((x) => !x.decision && x.level !== 'aucune').length;
    $('match-count').textContent = todo ? `(${todo} à valider)` : '';
  }

  function filterMatching() {
    const q = $('mq').value.trim().toLowerCase(), f = $('m-filter').value;
    state.match.filtered = state.match.rows.filter((x) => {
      const st = x.decision ? x.decision.status : null;
      if (f === 'todo' && (st || x.level === 'aucune')) return false;
      if (f === 'sure' && (st || x.level !== 'sure')) return false;
      if ((f === 'valide' || f === 'rejete') && st !== f) return false;
      if (f === 'aucune' && (st || x.level !== 'aucune')) return false;
      if (!q) return true;
      const owners = [...x.candidates, x.decision && x.decision.owner].filter(Boolean);
      return [x.name, x.identifiant, x.raw_serial, ...owners.map(ownerLabel)].join(' ').toLowerCase().includes(q);
    });
    const list = state.match.filtered;
    $('match-result').textContent = `${list.length} nom(s) affiché(s) sur ${state.match.rows.length}.`;
    $('match-rows-empty').hidden = list.length > 0;
    $('match-rows').innerHTML = list.map(matchRowHTML).join('');
  }
  ['mq', 'm-filter'].forEach((id) => $(id).addEventListener('input', filterMatching));

  function matchRowHTML(x) {
    const e = App.esc;
    const [lvl, cls] = LEVELS[x.level];
    let owner, decision;
    if (x.decision) {
      const o = x.decision.owner;
      owner = o ? `<strong>${e(o.name || '(copropriétaire introuvable)')}</strong> <span class="small mono">${e(o.login)}</span><div class="small">${e(lotsText(o.lots))}</div>`
                : '<span class="small">Aucun copropriétaire (ancien occupant, gardien, prestataire…)</span>';
      decision = `<span class="tag ${x.decision.status === 'valide' ? 'green' : 'muted-tag'}">${x.decision.status === 'valide' ? 'Validé' : 'Aucun'}</span>
        <div class="small">le ${e(fmt(x.decision.decided_at))}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="reset">Annuler la décision</button>`;
    } else {
      const cands = x.candidates;
      const others = state.match.owners.filter((o) => !cands.some((c) => c.login === o.login));
      const opts = (cands.length ? `<optgroup label="Propositions">${cands.map((c) => `<option value="${e(c.login)}">${e(ownerLabel(c))}</option>`).join('')}</optgroup>` : '<option value="">Choisir un copropriétaire…</option>')
        + `<optgroup label="Tous les copropriétaires">${others.map((o) => `<option value="${e(o.login)}">${e(ownerLabel(o))}</option>`).join('')}</optgroup>`;
      const chosen = state.match.choice[x.key];
      const best = (chosen && state.match.owners.find((o) => o.login === chosen)) || cands[0];
      owner = `<span class="tag ${cls}">${lvl}</span>
        ${best ? `<div class="match-best"><strong>${e(best.name)}</strong> <span class="small mono">${e(best.login)}</span><div class="small">${e(lotsText(best.lots))}</div></div>` : ''}
        <select class="match-select" aria-label="Copropriétaire à associer à ${e(x.name)}">${chosen ? opts.replace(`value="${e(chosen)}"`, `value="${e(chosen)}" selected`) : opts}</select>`;
      decision = `<div class="match-actions">
        <button type="button" class="btn btn-primary btn-sm" data-act="valider">Valider</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="rejeter">Aucun copropriétaire</button></div>`;
    }
    return `<tr data-key="${e(x.key)}">
      <td data-label="Centrale"><div><strong>${e(x.name)}</strong>${x.identifiant ? `<div class="small">Identifiant : ${e(x.identifiant)}</div>` : ''}</div></td>
      <td data-label="Code série"><span class="serial">${e(x.raw_serial) || '<span class="small">—</span>'}</span></td>
      <td data-label="Copropriétaire"><div class="cell-stack">${owner}</div></td>
      <td data-label="Décision"><div class="cell-stack">${decision}</div></td>
    </tr>`;
  }

  // Un changement de sélection met à jour l'aperçu du copropriétaire choisi
  $('match-rows').addEventListener('change', (ev) => {
    const sel = ev.target.closest('.match-select');
    if (!sel) return;
    state.match.choice[sel.closest('tr').dataset.key] = sel.value;
    const o = state.match.owners.find((x) => x.login === sel.value);
    const box = sel.parentElement.querySelector('.match-best');
    if (o && box) box.innerHTML = `<strong>${App.esc(o.name)}</strong> <span class="small mono">${App.esc(o.login)}</span><div class="small">${App.esc(lotsText(o.lots))}</div>`;
  });

  $('match-rows').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr'), key = tr.dataset.key, act = btn.dataset.act;
    const payload = { key, action: act };
    if (act === 'valider') {
      payload.login = tr.querySelector('.match-select').value;
      if (!payload.login) return App.toast('Choisissez d’abord un copropriétaire dans la liste.');
    }
    btn.disabled = true;
    const r = await App.api('admin_match_decide', payload);
    if (!r.ok) { btn.disabled = false; return App.toast((r.errors && r.errors.owner) || r.error); }
    App.toast(act === 'valider' ? 'Rapprochement validé' : act === 'rejeter' ? 'Marqué « aucun copropriétaire »' : 'Décision annulée');
    loadMatching();
  });

  $('btn-match-bulk').addEventListener('click', async () => {
    const n = state.match.rows.filter((x) => !x.decision && x.level === 'sure').length;
    if (!(await App.confirm(`Valider les ${n} correspondances sûres ?\nChaque nom de la centrale est alors associé au seul copropriétaire qui porte exactement ce nom. Vous pourrez annuler une décision ligne par ligne.`, 'Valider'))) return;
    const r = await App.api('admin_match_bulk');
    if (!r.ok) return App.toast(r.error);
    App.toast(`${r.count} rapprochements validés`);
    loadMatching();
  });
  $('tab-btn-decl').addEventListener('click', () => showTab('decl'));
  $('tab-btn-central').addEventListener('click', () => showTab('central'));

  /* ------------------------------------------------------------ Centrale actuelle */
  const CENTRAL_STATUS = {
    declare: ['Déclaré', 'green'],
    perdu: ['Plus en possession', 'warn'],
    pas_a_moi: ['Refusé par le résident', ''],
    non_declare: ['Non déclaré', 'muted-tag'],
    sans_numero: ['Sans numéro', 'muted-tag'],
  };
  state.central = { rows: [], filtered: [] };

  async function loadCentral() {
    const r = await App.api('admin_central_list');
    if (!r.ok) { if (r.status === 401) show('login'); else App.toast(r.error); return; }
    state.central.rows = r.rows;
    state.central.outside = r.declared_outside;
    $('central-count').textContent = r.rows.length ? `(${r.rows.length})` : '';
    $('central-empty').hidden = r.rows.length > 0;
    $('central-main').hidden = !r.rows.length;
    $('central-meta').textContent = r.imported_at ? `Liste importée le ${fmt(r.imported_at)}. Visible uniquement dans l’administration.` : '';
    const rows = r.rows, c = (st) => rows.filter((x) => x.status === st).length;
    const items = [
      [rows.filter((x) => x.serial).length, 'badges avec numéro'],
      [c('declare'), 'déclarés'],
      [c('perdu'), 'plus en possession'],
      [c('non_declare'), 'non déclarés'],
      [c('pas_a_moi'), 'refusés'],
      [r.declared_outside == null ? '—' : r.declared_outside, 'déclarés hors centrale'],
    ];
    $('central-stats').innerHTML = items.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
    filterCentral();
  }

  function filterCentral() {
    const q = $('cq').value.trim().toLowerCase(), qs = App.normalizeSerial(q), st = $('c-status').value;
    state.central.filtered = state.central.rows.filter((x) => {
      if (st === 'duplicate' ? !x.duplicate : st && x.status !== st) return false;
      if (!q) return true;
      return [x.name, x.identifiant, x.raw_serial, x.detail, x.match && x.match.name, x.match && x.match.login].join(' ').toLowerCase().includes(q) || (qs.length >= 3 && x.serial.includes(qs));
    });
    const e = App.esc, list = state.central.filtered;
    const filtering = q || st;
    $('central-result').textContent = filtering
      ? `${list.length} ligne(s) sur ${state.central.rows.length} — le téléchargement ne contiendra que ces lignes.`
      : `${list.length} ligne(s), dans l’ordre du fichier importé.`;
    $('central-rows-empty').hidden = list.length > 0;
    $('central-rows').innerHTML = list.slice(0, 1000).map((x) => {
      const [label, cls] = CENTRAL_STATUS[x.status];
      return `<tr>
        <td data-label="Nom"><div>${e(x.name) || '<span class="small">—</span>'}${x.match ? `<div class="small">${x.match.status === 'valide' ? '→ ' + e(x.match.name || '') + ' <span class="mono">' + e(x.match.login) + '</span>' : '→ aucun copropriétaire'}</div>` : ''}</div></td>
        <td data-label="Identifiant">${e(x.identifiant) || ''}</td>
        <td data-label="Code série"><span class="serial">${e(x.raw_serial) || '<span class="small">—</span>'}</span>${x.duplicate ? ' <span class="tag warn" title="Ce code série apparaît plusieurs fois dans la liste">En double</span>' : ''}</td>
        <td data-label="Statut"><span class="tag ${cls}">${label}</span></td>
        <td data-label="Détail">${e(x.detail) || ''}</td>
        <td data-label="Date" class="small">${e(fmt(x.date))}</td>
      </tr>`;
    }).join('');
  }
  ['cq', 'c-status'].forEach((id) => $(id).addEventListener('input', filterCentral));

  $('btn-central-export').addEventListener('click', () => {
    const filtering = $('cq').value.trim() || $('c-status').value;
    const ids = filtering ? state.central.filtered.map((x) => x.id) : [];
    if (filtering && !ids.length) return App.toast('Aucune ligne à télécharger avec ces filtres.');
    if (window.MOCK_CENTRAL_EXPORT) return window.MOCK_CENTRAL_EXPORT(ids);
    window.location.href = `${window.API_URL}?action=admin_central_export&csrf=${encodeURIComponent(App.csrf)}${ids.length ? '&ids=' + ids.join(',') : ''}`;
  });

  document.querySelectorAll('[data-open-import]').forEach((b) => b.addEventListener('click', () => {
    $('central-form').reset();
    $('central-error').hidden = true;
    const n = state.central.rows.length;
    $('central-current').textContent = n ? `Liste actuelle : ${n} lignes. Elle sera remplacée par le nouveau fichier.` : 'Aucune liste importée pour l’instant.';
    $('central-dialog').showModal();
  }));
  $('central-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) $('central-text').value = await App.readTextFile(f);
  });
  $('central-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = $('central-text').value;
    const fail = (m) => { $('central-error').textContent = m; $('central-error').hidden = false; };
    if (!content.trim()) return fail('Choisissez un fichier ou collez son contenu.');
    const r = await App.api('admin_import_central', { content });
    if (!r.ok) return fail(r.error);
    $('central-dialog').close();
    App.toast(`${r.count} lignes importées, dont ${r.with_serial} avec un code série`);
    loadCentral();
    loadCentralCount();
    refresh();
  });
  $('lots-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const csv = $('lots-text').value;
    if (!csv.trim()) { $('lots-error').textContent = 'Choisissez un fichier ou collez la liste.'; $('lots-error').hidden = false; return; }
    const r = await App.api('admin_import_lots', { csv });
    if (!r.ok) { $('lots-error').textContent = r.error; $('lots-error').hidden = false; return; }
    $('lots-dialog').close();
    App.toast(r.owners ? `${r.count} lots et ${r.owners} copropriétaires importés` : `${r.count} lots importés`);
    refresh();
    loadLots();
  });
  $('lots-clear').addEventListener('click', async () => {
    if (!(await App.confirm('Vider la liste des lots ? Les numéros saisis ne seront plus contrôlés.', 'Vider la liste'))) return;
    await App.api('admin_clear_lots');
    $('lots-dialog').close();
    refresh();
    loadLots();
  });

  /* ------------------------------------------------------------ Purge */
  $('btn-purge').addEventListener('click', () => {
    $('purge-form').reset(); $('purge-error').hidden = true;
    $('purge-dialog').showModal();
  });
  $('purge-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await App.api('admin_purge', { confirm: $('purge-confirm').value.trim().toUpperCase() });
    if (!r.ok) { $('purge-error').textContent = r.error; $('purge-error').hidden = false; return; }
    $('purge-dialog').close();
    App.toast('Base purgée');
    refresh();
  });

  async function loadCentralCount() {
    const r = await App.api('admin_central_list');
    if (r.ok) { state.central.rows = r.rows; $('central-count').textContent = r.rows.length ? `(${r.rows.length})` : ''; }
    const l = await App.api('admin_lots_list');
    if (l.ok) { state.lots.rows = l.rows; $('lots-count').textContent = l.rows.length ? `(${l.rows.length})` : ''; }
    const m = await App.api('admin_matching_list');
    if (m.ok) { state.match.rows = m.rows; state.match.owners = m.owners; updateMatchCount(); }
  }

  /* ------------------------------------------------------------ Init */
  (async function init() {
    $('logo').outerHTML = App.DONJON_SVG;
    const r = await App.loadSession().catch(() => ({ ok: false }));
    if (r.residence) $('residence-name').textContent = r.residence;
    if (r.admin) { await refresh(); show('dash'); loadCentralCount(); } else show('login');
  })();
})();
