/* Page résident */
(function () {
  'use strict';
  const App = window.App;
  const $ = (id) => document.getElementById(id);

  const state = {
    badges: [],
    badgeErrors: {},
    declarationId: null,
    residentEmail: null,
    declarations: [],
    accessEmail: '',
    proposals: [],   // badges de l'ancienne centrale proposés : [{token, hint}]
    answers: {},     // jeton -> 'oui' | 'perdu' | 'pas_a_moi'
  };

  const views = ['form', 'done', 'access', 'mine'];
  function show(view) {
    views.forEach((v) => { $('view-' + v).hidden = v !== view; });
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ Form */
  const form = $('decl-form');

  function renderBadges() {
    const list = $('badge-list');
    list.innerHTML = state.badges.map((b, i) => App.badgeCardHTML(b, i, state.badgeErrors[i])).join('');
    $('badge-empty').hidden = state.badges.length > 0;
    $('btn-add').textContent = state.badges.length ? '+ Ajouter un autre badge' : '+ Ajouter un badge';
  }

  $('badge-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = Number(btn.closest('.badge-card').dataset.index);
    if (btn.dataset.act === 'del') {
      const b = state.badges[i];
      if (!(await App.confirm(`Retirer le badge ${App.badgeLabel(b)} de la déclaration ?`, 'Retirer'))) return;
      state.badges.splice(i, 1);
      if (b.known_token) delete state.answers[b.known_token]; // la question sera reposée
      state.badgeErrors = {};
      renderBadges();
      renderProposals();
    } else {
      await editBadge(i);
    }
  });

  async function editBadge(i) {
    const isNew = i == null;
    const current = isNew ? null : state.badges[i];
    const others = state.badges.filter((_, j) => j !== i).map((b) => b.serial).filter(Boolean);
    const result = await App.BadgeDialog.open({
      badge: current, otherSerials: others, declarationId: state.declarationId,
      serverError: isNew ? null : state.badgeErrors[i],
    });
    if (!result) return;
    if (isNew) state.badges.push(result);
    else { state.badges[i] = result; delete state.badgeErrors[i]; }
    App.setFieldError($('f-badges'), null);
    renderBadges();
    App.toast(isNew ? `Badge ${App.badgeLabel(result)} ajouté` : `Badge ${App.badgeLabel(result)} modifié`);
  }

  /* ------------------------------------------------------------ Badges de l'ancienne centrale */
  const ANSWER_LABELS = { oui: 'Toujours en votre possession', perdu: 'Plus en votre possession', pas_a_moi: 'Ce n’est pas votre badge' };

  function identityPayload() {
    return { lot: form.lot.value.trim(), nom: form.nom.value.trim(), id_syndic: form.id_syndic.value.trim(), declaration_id: state.declarationId || 0 };
  }

  let suggestSeq = 0;
  async function fetchProposals() {
    if (!App.conf.central) return;
    const id = identityPayload();
    const seq = ++suggestSeq;
    let list = [];
    if (id.lot || id.nom.length >= 3 || id.id_syndic.length === 7) {
      const r = await App.api('suggest_badges', id).catch(() => ({ ok: false }));
      if (seq !== suggestSeq || !r.ok) return;
      list = r.suggestions;
    }
    // garder les badges déjà traités, même s'ils ne correspondent plus à l'identité saisie
    const kept = state.proposals.filter((p) => state.answers[p.token]);
    const byToken = new Map(kept.map((p) => [p.token, p]));
    list.forEach((p) => byToken.set(p.token, p));
    state.proposals = [...byToken.values()];
    renderProposals();
  }
  const fetchProposalsSoon = App.debounce(fetchProposals, 500);

  function renderProposals() {
    const box = $('central-box');
    box.hidden = !state.proposals.length;
    if (!state.proposals.length) return;
    const n = state.proposals.length;
    $('central-intro').textContent = n > 1
      ? `${n} badges de l’ancienne centrale semblent être à votre nom. Pour chacun, sont-ils toujours en votre possession (ou celle de votre locataire) ?`
      : 'Un badge de l’ancienne centrale semble être à votre nom. Est-il toujours en votre possession (ou celle de votre locataire) ?';
    $('central-list').innerHTML = state.proposals.map((p) => {
      const a = state.answers[p.token];
      const head = `<div class="prop-badge"><span class="badge-prefix">Badge se terminant par</span> <strong>${App.esc(p.hint)}</strong></div>`;
      if (a) {
        return `<div class="prop answered ${a}" data-token="${App.esc(p.token)}">${head}
          <div class="prop-answer"><span class="prop-state">${ANSWER_LABELS[a]}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-act="reset">Changer la réponse</button></div></div>`;
      }
      return `<div class="prop" data-token="${App.esc(p.token)}">${head}
        <div class="prop-actions" role="group" aria-label="Badge se terminant par ${App.esc(p.hint)}">
          <button type="button" class="btn btn-primary btn-sm" data-act="oui">Oui, je l’ai</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="perdu">Non, je ne l’ai plus</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="pas_a_moi">Pas à moi</button>
        </div></div>`;
    }).join('');
  }

  $('central-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const token = btn.closest('.prop').dataset.token;
    const p = state.proposals.find((x) => x.token === token);
    const act = btn.dataset.act;
    App.setFieldError($('f-central'), null);
    if (act === 'oui') {
      const result = await App.BadgeDialog.open({ known: { token: p.token, hint: p.hint }, declarationId: state.declarationId });
      if (!result) return;
      state.badges.push(result);
      state.answers[token] = 'oui';
      App.setFieldError($('f-badges'), null);
      renderBadges();
      App.toast(`Badge ${App.badgeLabel(result)} ajouté à votre déclaration`);
    } else if (act === 'reset') {
      if (state.answers[token] === 'oui') state.badges = state.badges.filter((b) => b.known_token !== token);
      delete state.answers[token];
      renderBadges();
    } else {
      state.answers[token] = act;
    }
    renderProposals();
  });

  $('btn-add').addEventListener('click', () => editBadge(null));

  // Saisie : chiffres seulement pour le lot, majuscules pour l'identifiant syndic
  form.lot.addEventListener('input', () => { form.lot.value = form.lot.value.replace(/\D/g, '').slice(0, 4); clearIdentityErrors(); });
  form.id_syndic.addEventListener('input', () => { form.id_syndic.value = form.id_syndic.value.toUpperCase().replace(/\s/g, ''); clearIdentityErrors(); });
  form.nom.addEventListener('input', clearIdentityErrors);
  ['lot', 'nom', 'id_syndic'].forEach((n) => form[n].addEventListener('input', fetchProposalsSoon));
  form.consent.addEventListener('change', () => App.setFieldError($('f-consent'), null));
  form.email.addEventListener('input', () => App.setFieldError($('f-email'), null));
  function clearIdentityErrors() {
    ['f-identity', 'f-lot', 'f-nom', 'f-id_syndic'].forEach((id) => App.setFieldError($(id), null));
  }

  function validateForm() {
    clearIdentityErrors();
    ['f-badges', 'f-central', 'f-email', 'f-consent'].forEach((id) => App.setFieldError($(id), null));
    let first = null;
    const fail = (id, msg, el) => { App.setFieldError($(id), msg); first = first || el; };
    const lot = form.lot.value.trim(), nom = form.nom.value.trim(), syn = form.id_syndic.value.trim();
    if (!lot && !nom && !syn) fail('f-identity', 'Indiquez au moins un numéro de lot, un nom ou un identifiant syndic.', form.lot);
    if (lot && (!/^\d{1,4}$/.test(lot) || Number(lot) === 0)) fail('f-lot', '1 à 4 chiffres (ex. 0102).', form.lot);
    if (lot && App.conf.strict_lots && App.conf.lots && App.conf.lots.length &&
        !App.conf.lots.some((l) => String(Number(l.numero)) === String(Number(lot)))) {
      fail('f-lot', `Le lot ${lot} n'existe pas dans la liste de l'immeuble.`, form.lot);
    }
    if (syn && !/^[A-Z][0-9]{6}$/i.test(syn)) fail('f-id_syndic', 'Une lettre suivie de 6 chiffres (ex. C543210).', form.id_syndic);
    const pending = state.proposals.filter((p) => !state.answers[p.token]);
    if (pending.length) fail('f-central', pending.length > 1 ? `Répondez pour les ${pending.length} badges proposés.` : 'Répondez pour le badge proposé.', $('central-list').querySelector('button'));
    const reported = Object.values(state.answers).some((a) => a !== 'oui');
    if (!state.badges.length && !reported) fail('f-badges', 'Ajoutez au moins un badge.', $('btn-add'));
    const em = form.email.value.trim();
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) fail('f-email', "L'adresse email n'est pas valide.", form.email);
    if (!form.consent.checked) fail('f-consent', 'Merci de cocher la case pour continuer.', form.consent);
    if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return !first;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('form-error').hidden = true;
    if (!validateForm()) return;
    const btn = $('btn-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Envoi…';
    try {
      const r = await App.api('submit', {
        declaration_id: state.declarationId || 0,
        lot: form.lot.value.trim(), nom: form.nom.value.trim(), id_syndic: form.id_syndic.value.trim(),
        email: form.email.value.trim(), consent: form.consent.checked, website: form.website.value,
        badges: state.badges,
        central_answers: Object.entries(state.answers).filter(([, a]) => a !== 'oui').map(([token, answer]) => ({ token, answer })),
      });
      if (r.ok) return onSaved(r.declaration);
      showServerErrors(r);
    } catch (err) {
      showFormError('Connexion impossible. Vérifiez votre réseau et réessayez.');
    } finally {
      btn.disabled = false;
      btn.textContent = state.declarationId ? 'Enregistrer les modifications' : 'Envoyer ma déclaration';
    }
  });

  function showFormError(msg) {
    $('form-error').textContent = msg;
    $('form-error').hidden = false;
    $('form-error').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function showServerErrors(r) {
    const errs = r.errors || {};
    const map = { identity: 'f-identity', lot: 'f-lot', nom: 'f-nom', id_syndic: 'f-id_syndic', email: 'f-email', consent: 'f-consent', badges: 'f-badges' };
    Object.entries(map).forEach(([k, id]) => { if (errs[k]) App.setFieldError($(id), errs[k]); });
    if (errs.badges_detail) { state.badgeErrors = errs.badges_detail; renderBadges(); }
    showFormError(r.error || 'Une erreur est survenue.');
    if (r.status === 419) App.loadSession();
  }

  function onSaved(decl) {
    const recap = $('done-recap');
    recap.innerHTML = decl.badges.map((b, i) => `<li>${App.badgeCardHTML(b, i).replace(/<div class="badge-actions">[\s\S]*?<\/div>/, '')}</li>`).join('') +
      (decl.central_answers || []).map((a) => `<li class="recap-answer">Badge se terminant par <strong>${App.esc(a.hint)}</strong> : ${ANSWER_LABELS[a.answer].toLowerCase()}</li>`).join('');
    const withEmail = !!decl.email;
    $('done-title').textContent = state.declarationId ? 'Modifications enregistrées' : 'Merci, votre déclaration est enregistrée';
    $('done-msg').textContent = withEmail
      ? `Pour la modifier plus tard, utilisez « Modifier une déclaration » avec l'adresse ${decl.email}.`
      : 'Vous n’avez pas indiqué d’email : pour toute modification, contactez le conseil syndical.';
    $('btn-done-mine').hidden = !state.residentEmail;
    resetForm(false);
    show('done');
  }

  function resetForm(keepEmail) {
    form.reset();
    state.badges = []; state.badgeErrors = {}; state.declarationId = null;
    state.proposals = []; state.answers = {}; suggestSeq++;
    renderProposals();
    if (keepEmail && state.residentEmail) form.email.value = state.residentEmail;
    $('editing-banner').hidden = true;
    $('form-error').hidden = true;
    $('btn-submit').textContent = 'Envoyer ma déclaration';
    clearIdentityErrors();
    renderBadges();
  }

  function loadIntoForm(decl) {
    resetForm(false);
    state.declarationId = decl.id;
    state.badges = decl.badges.map((b) => ({ ...b }));
    // réponses déjà données aux badges de l'ancienne centrale
    state.badges.filter((b) => b.known_token).forEach((b) => {
      state.answers[b.known_token] = 'oui';
      state.proposals.push({ token: b.known_token, hint: b.hint });
    });
    (decl.central_answers || []).forEach((a) => {
      state.answers[a.token] = a.answer;
      state.proposals.push({ token: a.token, hint: a.hint });
    });
    form.lot.value = decl.lot || '';
    form.nom.value = decl.nom || '';
    form.id_syndic.value = decl.id_syndic || '';
    form.email.value = decl.email || '';
    $('editing-banner').innerHTML = `Vous modifiez la déclaration du ${App.esc(formatDate(decl.created_at))}. <a href="#modifier">Annuler</a>`;
    $('editing-banner').hidden = false;
    $('btn-submit').textContent = 'Enregistrer les modifications';
    renderBadges();
    renderProposals();
    show('form');
    fetchProposals();
  }

  $('btn-new').addEventListener('click', () => { resetForm(true); location.hash = ''; show('form'); });

  /* ------------------------------------------------------------ Access by code */
  async function sendCode() {
    const email = $('in-access-email').value.trim();
    $('access-error').hidden = true; $('access-info').hidden = true;
    App.setFieldError($('f-access-email'), null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { App.setFieldError($('f-access-email'), 'Adresse email non valide.'); return; }
    const btn = $('btn-send-code');
    btn.disabled = true;
    const r = await App.api('request_code', { email });
    btn.disabled = false;
    if (!r.ok) { $('access-error').textContent = (r.errors && r.errors.email) || r.error; $('access-error').hidden = false; return; }
    state.accessEmail = email;
    $('access-info').textContent = r.message;
    $('access-info').hidden = false;
    $('form-email').hidden = true;
    $('form-code').hidden = false;
    $('in-code').value = '';
    $('in-code').focus();
  }

  $('form-email').addEventListener('submit', (e) => { e.preventDefault(); sendCode(); });
  $('btn-resend').addEventListener('click', sendCode);
  $('btn-change-email').addEventListener('click', () => {
    $('form-code').hidden = true; $('form-email').hidden = false; $('access-info').hidden = true; $('access-error').hidden = true;
  });
  $('in-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (e.target.value.length === 6) $('form-code').requestSubmit();
  });
  $('form-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('access-error').hidden = true;
    const r = await App.api('verify_code', { email: state.accessEmail, code: $('in-code').value });
    if (!r.ok) {
      $('access-error').textContent = r.error;
      $('access-error').hidden = false;
      if (r.expired) $('btn-change-email').click();
      return;
    }
    await App.loadSession(); // nouveau jeton CSRF après régénération de la session
    state.residentEmail = r.email;
    state.declarations = r.declarations;
    renderMine();
    show('mine');
  });
  $('back-to-form').addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });

  /* ------------------------------------------------------------ My declarations */
  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T'));
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function renderMine() {
    $('mine-email').textContent = state.residentEmail;
    const list = $('mine-list');
    if (!state.declarations.length) {
      list.innerHTML = '<p class="empty">Aucune déclaration associée à cette adresse.</p>';
      return;
    }
    list.innerHTML = state.declarations.map((d) => {
      const who = [d.lot ? 'Lot ' + d.lot : '', d.nom, d.id_syndic].filter(Boolean).map(App.esc).join(' · ');
      const badges = d.badges.map((b) => `<span class="tag" style="font-family:ui-monospace,monospace">${App.esc(App.badgeLabel(b))}</span>`).join(' ');
      return `<div class="decl-item" data-id="${d.id}">
        <h3>${who || 'Déclaration'}</h3>
        <div class="meta">Déclarée le ${App.esc(formatDate(d.created_at))} · ${d.badges.length} badge${d.badges.length > 1 ? 's' : ''}</div>
        <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:6px">${badges}</div>
        <div class="actions">
          <button type="button" class="btn btn-secondary btn-sm" data-act="edit">Modifier</button>
          <button type="button" class="btn btn-danger btn-sm" data-act="delete">Supprimer</button>
        </div>
      </div>`;
    }).join('');
  }

  $('mine-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('.decl-item').dataset.id);
    const decl = state.declarations.find((d) => d.id === id);
    if (btn.dataset.act === 'edit') { loadIntoForm(decl); history.replaceState(null, '', location.pathname); return; }
    if (!(await App.confirm('Supprimer cette déclaration et tous ses badges ?'))) return;
    const r = await App.api('delete_declaration', { id });
    if (!r.ok) return App.toast(r.error);
    state.declarations = state.declarations.filter((d) => d.id !== id);
    renderMine();
    App.toast('Déclaration supprimée');
  });

  $('btn-mine-new').addEventListener('click', () => { resetForm(true); history.replaceState(null, '', location.pathname); show('form'); });
  $('btn-logout').addEventListener('click', async () => {
    await App.api('resident_logout');
    state.residentEmail = null; state.declarations = [];
    resetForm(false);
    location.hash = '';
    show('form');
  });

  /* ------------------------------------------------------------ Routing */
  async function route() {
    if (location.hash === '#modifier') {
      if (state.residentEmail) {
        const r = await App.api('my_declarations');
        if (r.ok) { state.declarations = r.declarations; renderMine(); show('mine'); return; }
        state.residentEmail = null;
      }
      $('form-email').hidden = false; $('form-code').hidden = true;
      $('access-error').hidden = true; $('access-info').hidden = true;
      show('access');
      setTimeout(() => $('in-access-email').focus(), 50);
    } else {
      if ($('view-form').hidden) show('form');
    }
  }
  window.addEventListener('hashchange', route);

  /* ------------------------------------------------------------ Init */
  (async function init() {
    $('logo').outerHTML = App.DONJON_SVG;
    const r = await App.loadSession().catch(() => ({ ok: false }));
    if (!r.ok) {
      show('form');
      return showFormError('Le service est momentanément indisponible. Réessayez plus tard.');
    }
    if (r.residence) { $('residence-name').textContent = r.residence; document.title = 'Badges — ' + r.residence; }
    if (r.contact) {
      ['contact-link', 'footer-contact'].forEach((id) => { $(id).textContent = r.contact; $(id).href = 'mailto:' + r.contact; });
    }
    $('lots-list').innerHTML = (r.lots || []).map((l) => `<option value="${App.esc(String(l.numero).padStart(4, '0'))}">${App.esc(l.libelle || '')}</option>`).join('');
    state.residentEmail = r.resident_email || null;
    renderBadges();
    show('form');
    route();
  })();
})();
