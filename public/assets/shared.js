/* Code partagé entre la page résident et la page administrateur. */
(function () {
  'use strict';

  const App = (window.App = window.App || {});
  App.csrf = '';
  App.conf = { ocr: 'local', serial_min: 4, serial_max: 32, lots: [] };

  /* ------------------------------------------------------------ API */
  App.api = async function (action, data) {
    if (window.MOCK_API) return window.MOCK_API(action, data || {});
    const res = await fetch((window.API_URL || 'api.php') + '?action=' + encodeURIComponent(action), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': App.csrf },
      body: JSON.stringify(data || {}),
    });
    let json;
    try { json = await res.json(); } catch (e) { json = { ok: false, error: 'Réponse inattendue du serveur.' }; }
    json.status = res.status;
    return json;
  };

  App.loadSession = async function () {
    const r = await App.api('session');
    if (r.ok) { App.csrf = r.csrf; App.conf = r; }
    return r;
  };

  /* ------------------------------------------------------------ Helpers */
  App.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  App.normalizeSerial = function (s) {
    s = String(s || '').replace(/[\s\-:.]/g, '').toUpperCase();
    return /^S[0-9A-F]+$/.test(s) ? s.slice(1) : s; // « S-1A2B3C4D » : format de la centrale
  };
  /** Libellé d'un badge : numéro, ou fin du numéro pour un badge de l'ancienne centrale (numéro masqué) */
  App.badgeLabel = (b) => (b.known_token ? `…${b.hint}` : b.serial);

  /** Lit un fichier texte en UTF-8, ou en Windows-1252 (exports Excel / logiciels de centrale) */
  App.readTextFile = async function (file) {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  };
  App.serialError = function (s) {
    const min = App.conf.serial_min || 4, max = App.conf.serial_max || 32;
    if (!s) return 'Le numéro de série est obligatoire.';
    if (!/^[0-9A-F]+$/.test(s)) return 'Le numéro ne doit contenir que des chiffres 0–9 et des lettres A–F.';
    if (s.length < min || s.length > max) return `Le numéro doit faire entre ${min} et ${max} caractères.`;
    return null;
  };
  App.stairsLabel = (b) => ['a', 'b', 'c'].filter((k) => b['stair_' + k]).map((k) => k.toUpperCase());
  /** Accès lisibles : « A, C · Télécommande parking » */
  App.accessLabel = (b) => [App.stairsLabel(b).join(', '), b.parking ? 'Télécommande parking' : ''].filter(Boolean).join(' · ');
  App.occupantLabel = (o) => (o === 'locataire' ? 'Locataire' : 'Copropriétaire');
  App.debounce = function (fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let toastTimer;
  App.toast = function (msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  };

  /** Confirmation dans la page (remplace window.confirm) → Promise<boolean> */
  App.confirm = function (message, okLabel) {
    let dlg = document.getElementById('confirm-dialog');
    if (!dlg) {
      document.body.insertAdjacentHTML('beforeend', `
<dialog id="confirm-dialog" class="confirm-dialog" aria-labelledby="confirm-msg">
  <div class="dlg-body"><p id="confirm-msg" style="margin:0;white-space:pre-line"></p></div>
  <div class="dlg-foot">
    <button type="button" class="btn btn-ghost" data-v="0">Annuler</button>
    <button type="button" class="btn btn-danger" data-v="1" id="confirm-ok">Confirmer</button>
  </div>
</dialog>`);
      dlg = document.getElementById('confirm-dialog');
    }
    document.getElementById('confirm-msg').textContent = message;
    document.getElementById('confirm-ok').textContent = okLabel || 'Supprimer';
    return new Promise((resolve) => {
      const done = (v) => { dlg.close(); dlg.querySelectorAll('button').forEach((b) => { b.onclick = null; }); dlg.oncancel = null; resolve(v); };
      dlg.querySelectorAll('button').forEach((b) => { b.onclick = () => done(b.dataset.v === '1'); });
      dlg.oncancel = (e) => { e.preventDefault(); done(false); };
      dlg.showModal();
    });
  };

  App.setFieldError = function (fieldEl, msg) {
    if (!fieldEl) return;
    fieldEl.classList.toggle('has-error', !!msg);
    let p = fieldEl.querySelector(':scope > .error-msg');
    if (msg) {
      if (!p) { p = document.createElement('p'); p.className = 'error-msg'; fieldEl.appendChild(p); }
      p.textContent = msg;
    } else if (p) p.remove();
  };

  App.badgeCardHTML = function (b, i, error) {
    const stairs = App.stairsLabel(b).map((s) => `<span class="tag">Esc. ${s}</span>`).join('') + (b.parking ? '<span class="tag">Parking</span>' : '');
    const occ = `<span class="tag green">${App.occupantLabel(b.occupant)}</span>`;
    const tenant = b.occupant === 'locataire' && (b.tenant_name || b.tenant_phone || b.tenant_email)
      ? `<span>${App.esc([b.tenant_name, b.tenant_phone, b.tenant_email].filter(Boolean).join(' · '))}</span>` : '';
    const label = App.badgeLabel(b);
    const central = b.known_token
      ? '<span class="tag sand">Ancienne centrale</span>'
      : Array.isArray(b.central_names)
        ? (b.central_names.length ? `<span class="tag sand">Centrale : ${App.esc(b.central_names.join(' / '))}</span>` : '<span class="tag warn">Absent de la centrale</span>')
        : '';
    return `<div class="badge-card${error ? ' has-error' : ''}" data-index="${i}">
      <div class="badge-serial">${b.known_token ? `<span class="badge-prefix">Se terminant par</span> ` : ''}${App.esc(label)}</div>
      <div class="badge-meta">${stairs}${occ}${central}</div>
      ${tenant ? `<div class="badge-meta">${tenant}</div>` : ''}
      <div class="badge-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="edit" aria-label="Modifier le badge ${App.esc(label)}">Modifier</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="del" style="color:var(--danger)" aria-label="Supprimer le badge ${App.esc(label)}">Supprimer</button>
      </div>
      ${error ? `<p class="error-msg">${App.esc(Object.values(error).join(' '))}</p>` : ''}
    </div>`;
  };

  /* ------------------------------------------------------------ Images */
  App.resizeImage = function (file, maxSide) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  };

  let tesseractLoading;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tesseractLoading) {
      tesseractLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = () => resolve(window.Tesseract);
        s.onerror = () => { tesseractLoading = null; reject(new Error('Chargement impossible')); };
        document.head.appendChild(s);
      });
    }
    return tesseractLoading;
  }

  /** Extrait des suites hexadécimales plausibles d'un texte OCR brut */
  App.hexCandidates = function (text) {
    const min = App.conf.serial_min || 4, max = App.conf.serial_max || 32;
    const up = String(text || '').toUpperCase().replace(/O/g, '0').replace(/[IL|]/g, '1');
    const found = new Set();
    (up.match(/[0-9A-F]+(?:[ \-:][0-9A-F]+)*/g) || []).forEach((m) => {
      const joined = m.replace(/[ \-:]/g, '');
      if (joined.length >= min && joined.length <= max) found.add(joined);
      m.split(/[ \-:]/).forEach((p) => { if (p.length >= Math.max(min, 6) && p.length <= max) found.add(p); });
    });
    // privilégier les suites contenant des chiffres, puis les plus longues
    return [...found].filter((s) => /\d/.test(s)).sort((a, b) => b.length - a.length);
  };

  App.readSerialFromPhoto = async function (dataUrl) {
    if (window.DEMO_OCR) {
      const r = await window.DEMO_OCR(dataUrl);
      if (r) return r;
    }
    if (App.conf.ocr === 'server') {
      const r = await App.api('ocr', { image: dataUrl });
      if (!r.ok) throw new Error(r.error || 'Lecture impossible.');
      if (r.mode === 'server') return r;
    }
    const T = await loadTesseract();
    const worker = await T.createWorker('eng');
    try {
      await worker.setParameters({ tessedit_char_whitelist: '0123456789ABCDEFabcdef -:' });
      const { data } = await worker.recognize(dataUrl);
      const c = App.hexCandidates(data.text);
      return { serial: c[0] || '', candidates: c.slice(1, 5), confidence: c.length ? 'medium' : 'low', mode: 'local' };
    } finally {
      worker.terminate();
    }
  };

  /* ------------------------------------------------------------ Badge dialog */
  const DIALOG_HTML = `
<dialog id="badge-dialog" aria-labelledby="badge-dialog-title">
  <form class="dlg" method="dialog" novalidate>
    <div class="dlg-head">
      <h2 id="badge-dialog-title">Ajouter un badge</h2>
      <button type="button" class="icon-btn" data-close aria-label="Fermer">&times;</button>
    </div>
    <div class="dlg-body">
      <div class="field" id="f-serial">
        <label for="bd-serial">Numéro de série du badge</label>
        <div class="serial-row">
          <input id="bd-serial" name="serial" type="text" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="3A4F0012" maxlength="48">
          <button type="button" class="btn btn-secondary photo-btn" id="bd-photo-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span class="lbl-long">Photographier</span><span class="lbl-short">Photo</span>
          </button>
          <input type="file" id="bd-photo" accept="image/*" capture="environment" hidden>
        </div>
        <p class="hint" id="bd-serial-hint">Chiffres 0–9 et lettres A–F, imprimés ou gravés sur le badge. Vous pouvez aussi le photographier : le numéro sera lu automatiquement.</p>
        <div class="ocr-box" id="bd-ocr" hidden>
          <img id="bd-ocr-img" alt="Photo du badge">
          <div class="ocr-status" id="bd-ocr-status" aria-live="polite"></div>
        </div>
      </div>
      <div class="field" id="f-stairs">
        <span class="label" id="lbl-stairs">Accès donnés par ce badge</span>
        <div class="pills" role="group" aria-labelledby="lbl-stairs">
          <label class="pill"><input type="checkbox" name="stair_a"><span>A</span></label>
          <label class="pill"><input type="checkbox" name="stair_b"><span>B</span></label>
          <label class="pill"><input type="checkbox" name="stair_c"><span>C</span></label>
        </div>
        <label class="check parking-check"><input type="checkbox" name="parking" id="bd-parking"> <span><strong>Télécommande de parking</strong><br><span class="muted">Cochez s’il s’agit d’une télécommande (ou d’un badge) qui ouvre le parking.</span></span></label>
      </div>
      <div class="field" id="f-occupant">
        <span class="label" id="lbl-occ">Ce badge est pour</span>
        <div class="pills two" role="radiogroup" aria-labelledby="lbl-occ">
          <label class="pill wide"><input type="radio" name="occupant" value="coproprietaire"><span>Copropriétaire</span></label>
          <label class="pill wide"><input type="radio" name="occupant" value="locataire"><span>Locataire</span></label>
        </div>
      </div>
      <div class="tenant-box" id="bd-tenant" hidden>
        <p class="note">Coordonnées du locataire — <strong>facultatif, mais préférable</strong> pour pouvoir le joindre en cas de problème de badge.</p>
        <div class="field" id="f-tenant_name">
          <label for="bd-tname">Nom du locataire <span class="opt">(facultatif)</span></label>
          <input id="bd-tname" name="tenant_name" type="text" autocomplete="off" maxlength="80">
        </div>
        <div class="field" id="f-tenant_phone">
          <label for="bd-tphone">Téléphone du locataire <span class="opt">(facultatif)</span></label>
          <input id="bd-tphone" name="tenant_phone" type="tel" inputmode="tel" autocomplete="off" placeholder="06 12 34 56 78" maxlength="20">
        </div>
        <div class="field" id="f-tenant_email">
          <label for="bd-temail">Email du locataire <span class="opt">(facultatif)</span></label>
          <input id="bd-temail" name="tenant_email" type="email" inputmode="email" autocomplete="off" maxlength="160">
        </div>
      </div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="btn btn-ghost" data-close>Annuler</button>
      <button type="submit" class="btn btn-primary" id="bd-save">Ajouter ce badge</button>
    </div>
  </form>
</dialog>`;

  App.BadgeDialog = (function () {
    let dlg, form, resolveFn, ctx, checkSeq = 0, serialStatus = null;

    function init() {
      if (dlg) return;
      document.body.insertAdjacentHTML('beforeend', DIALOG_HTML);
      dlg = document.getElementById('badge-dialog');
      form = dlg.querySelector('form');
      const serial = form.serial;

      dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });

      form.addEventListener('change', (e) => {
        if (e.target.name === 'occupant') toggleTenant();
        if (e.target.name && (e.target.name.startsWith('stair_') || e.target.name === 'parking')) App.setFieldError(document.getElementById('f-stairs'), null);
        if (e.target.name === 'occupant') App.setFieldError(document.getElementById('f-occupant'), null);
      });

      const liveCheck = App.debounce(checkSerial, 450);
      serial.addEventListener('input', () => { serialStatus = null; App.setFieldError(document.getElementById('f-serial'), null); clearOk(); liveCheck(); });
      serial.addEventListener('blur', () => { serial.value = App.normalizeSerial(serial.value); });

      document.getElementById('bd-photo-btn').addEventListener('click', () => document.getElementById('bd-photo').click());
      document.getElementById('bd-photo').addEventListener('change', onPhoto);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const b = collect();
        if (!validate(b)) return;
        if (ctx.known) return close(b);
        if (serialStatus === null) await checkSerial();
        if (serialStatus === false) { serial.focus(); return; }
        close(b);
      });
    }

    function clearOk() { const ok = document.querySelector('#f-serial .ok-msg'); if (ok) ok.remove(); }

    async function checkSerial() {
      if (ctx.known) return;
      const s = App.normalizeSerial(form.serial.value);
      const field = document.getElementById('f-serial');
      clearOk();
      if (!s) { serialStatus = null; return; }
      const err = App.serialError(s);
      if (err) { serialStatus = null; return; }
      if ((ctx.otherSerials || []).includes(s)) {
        serialStatus = false;
        App.setFieldError(field, 'Ce numéro figure déjà dans votre liste.');
        return;
      }
      if (ctx.originalSerial && s === ctx.originalSerial) { serialStatus = true; return; }
      const seq = ++checkSeq;
      const r = await App.api('check_serial', { serial: s, declaration_id: ctx.declarationId || 0 });
      if (seq !== checkSeq) return;
      if (!r.ok) { serialStatus = null; return; } // ne bloque pas : contrôle refait à l'envoi
      serialStatus = !!r.valid;
      if (!r.valid) App.setFieldError(field, r.message || 'Ce badge est déjà déclaré.');
      else {
        const p = document.createElement('p'); p.className = 'ok-msg'; p.textContent = '✓ Numéro disponible';
        field.appendChild(p);
      }
    }

    async function onPhoto(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const box = document.getElementById('bd-ocr');
      const status = document.getElementById('bd-ocr-status');
      const img = document.getElementById('bd-ocr-img');
      box.hidden = false;
      status.innerHTML = '<span class="spinner"></span>Préparation de la photo…';
      let dataUrl;
      try {
        dataUrl = await App.resizeImage(file, 1600);
        img.src = dataUrl;
        status.innerHTML = '<span class="spinner"></span>Lecture du numéro en cours…';
        const r = await App.readSerialFromPhoto(dataUrl);
        renderOcr(r);
      } catch (err) {
        status.innerHTML = `<span style="color:var(--danger)">${App.esc(err.message || 'Lecture impossible.')}</span> Saisissez le numéro à la main.`;
      }
    }

    function renderOcr(r) {
      const status = document.getElementById('bd-ocr-status');
      if (!r.serial) {
        status.innerHTML = 'Numéro non reconnu. Essayez une photo plus nette, de près et sans reflet, ou saisissez-le à la main.';
        return;
      }
      applySerial(r.serial);
      const low = r.confidence === 'low';
      const options = [r.serial, ...(r.candidates || [])];
      let html = `${low ? 'Lecture incertaine' : 'Numéro lu'} : <strong>${App.esc(r.serial)}</strong><br><span class="muted">Vérifiez qu’il correspond bien au badge.</span>`;
      if (options.length > 1) {
        html += '<div class="muted" style="margin-top:6px">Plusieurs numéros repérés, choisissez le bon :</div><div class="chips">' +
          options.map((c, i) => `<button type="button" class="chip" aria-pressed="${i === 0}" data-serial="${App.esc(c)}">${App.esc(c)}</button>`).join('') + '</div>';
      }
      status.innerHTML = html;
      status.querySelectorAll('.chip').forEach((ch) => ch.addEventListener('click', () => {
        applySerial(ch.dataset.serial);
        status.querySelector('strong').textContent = ch.dataset.serial;
        status.querySelectorAll('.chip').forEach((o) => o.setAttribute('aria-pressed', String(o === ch)));
      }));
    }

    function applySerial(s) {
      form.serial.value = s;
      serialStatus = null;
      App.setFieldError(document.getElementById('f-serial'), null);
      checkSerial();
    }

    function toggleTenant() {
      document.getElementById('bd-tenant').hidden = form.querySelector('input[name=occupant]:checked')?.value !== 'locataire';
    }

    function collect() {
      const occ = form.querySelector('input[name=occupant]:checked');
      const serial = ctx.known ? '' : App.normalizeSerial(form.serial.value);
      return {
        id: ctx.badge && ctx.badge.id ? ctx.badge.id : undefined,
        known_token: ctx.known ? ctx.known.token : undefined,
        hint: ctx.known ? ctx.known.hint : undefined,
        // administration : garder l'origine « ancienne centrale » tant que le numéro ne change pas
        from_central: ctx.badge && ctx.badge.from_central && serial === ctx.originalSerial ? true : undefined,
        serial,
        stair_a: form.stair_a.checked, stair_b: form.stair_b.checked, stair_c: form.stair_c.checked, parking: form.parking.checked,
        occupant: occ ? occ.value : '',
        tenant_name: form.tenant_name.value.trim(),
        tenant_phone: form.tenant_phone.value.trim(),
        tenant_email: form.tenant_email.value.trim(),
      };
    }

    function validate(b) {
      let ok = true, first = null;
      const fail = (id, msg, el) => { ok = false; App.setFieldError(document.getElementById(id), msg); first = first || el; };
      ['f-serial', 'f-stairs', 'f-occupant', 'f-tenant_phone', 'f-tenant_email'].forEach((id) => App.setFieldError(document.getElementById(id), null));
      const se = ctx.known ? null : App.serialError(b.serial);
      if (se) fail('f-serial', se, form.serial);
      else if ((ctx.otherSerials || []).includes(b.serial)) fail('f-serial', 'Ce numéro figure déjà dans votre liste.', form.serial);
      if (!b.stair_a && !b.stair_b && !b.stair_c && !b.parking) fail('f-stairs', 'Cochez au moins un escalier ou la télécommande de parking.', form.stair_a);
      if (!b.occupant) fail('f-occupant', 'Indiquez s’il s’agit d’un copropriétaire ou d’un locataire.', form.querySelector('input[name=occupant]'));
      if (b.occupant === 'locataire') {
        const ph = b.tenant_phone.replace(/[\s.\-()]/g, '').replace(/^\+33|^0033/, '0');
        if (b.tenant_phone && !/^0[1-9]\d{8}$/.test(ph)) fail('f-tenant_phone', 'Numéro de téléphone français attendu (10 chiffres).', form.tenant_phone);
        if (b.tenant_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.tenant_email)) fail('f-tenant_email', 'Adresse email non valide.', form.tenant_email);
      } else {
        b.tenant_name = b.tenant_phone = b.tenant_email = '';
      }
      if (first) first.focus();
      return ok;
    }

    function open(options) {
      init();
      ctx = options || {};
      const b = ctx.badge || {};
      ctx.originalSerial = b.serial || null;
      // Badge de l'ancienne centrale : numéro connu du conseil syndical, affiché masqué, non modifiable
      ctx.known = ctx.known || (b.known_token ? { token: b.known_token, hint: b.hint } : null);
      const editing = !!(b.serial || b.known_token);
      form.reset();
      serialStatus = null; checkSeq++;
      ['f-serial', 'f-stairs', 'f-occupant', 'f-tenant_phone', 'f-tenant_email'].forEach((id) => App.setFieldError(document.getElementById(id), null));
      clearOk();
      document.getElementById('bd-ocr').hidden = true;
      document.getElementById('badge-dialog-title').textContent = ctx.known ? `Badge se terminant par ${ctx.known.hint}` : editing ? 'Modifier le badge' : 'Ajouter un badge';
      document.getElementById('bd-save').textContent = editing ? 'Enregistrer' : ctx.known ? 'Confirmer ce badge' : 'Ajouter ce badge';
      form.serial.value = ctx.known ? `…${ctx.known.hint}` : (b.serial || '');
      form.serial.readOnly = !!ctx.known;
      document.getElementById('bd-photo-btn').hidden = !!ctx.known;
      document.getElementById('bd-serial-hint').textContent = ctx.known
        ? 'Badge déjà connu du conseil syndical : son numéro est enregistré, il n’y a rien à saisir. Indiquez seulement les escaliers et qui l’utilise.'
        : 'Chiffres 0–9 et lettres A–F, imprimés ou gravés sur le badge. Vous pouvez aussi le photographier : le numéro sera lu automatiquement.';
      form.stair_a.checked = !!b.stair_a; form.stair_b.checked = !!b.stair_b; form.stair_c.checked = !!b.stair_c; form.parking.checked = !!b.parking;
      if (b.occupant) form.querySelector(`input[name=occupant][value="${b.occupant}"]`).checked = true;
      form.tenant_name.value = b.tenant_name || '';
      form.tenant_phone.value = b.tenant_phone || '';
      form.tenant_email.value = b.tenant_email || '';
      toggleTenant();
      if (ctx.serverError) {
        Object.entries(ctx.serverError).forEach(([k, msg]) => {
          const id = k === 'stairs' ? 'f-stairs' : 'f-' + k;
          App.setFieldError(document.getElementById(id), msg);
        });
      }
      dlg.showModal();
      if (!editing && !ctx.known) setTimeout(() => form.serial.focus(), 50);
      return new Promise((res) => { resolveFn = res; });
    }

    function close(result) {
      dlg.close();
      if (resolveFn) { const r = resolveFn; resolveFn = null; r(result); }
    }

    return { open };
  })();

  /* Silhouette stylisée du donjon du château de Vincennes */
  App.DONJON_SVG = '<svg class="donjon" viewBox="0 0 34 40" aria-hidden="true">' +
    '<g fill="currentColor">' +
    '<rect x="10" y="7" width="14" height="25"/>' +
    '<rect x="8" y="5" width="4" height="27" rx="1.5"/><rect x="22" y="5" width="4" height="27" rx="1.5"/>' +
    '<rect x="8" y="2.5" width="4" height="3.5" rx="1.5"/><rect x="22" y="2.5" width="4" height="3.5" rx="1.5"/>' +
    '<rect x="13" y="4" width="2" height="4"/><rect x="16" y="4" width="2" height="4"/><rect x="19" y="4" width="2" height="4"/>' +
    '<path d="M1 28h3v-2h2v2h3v-2h2v2h12v-2h2v2h3v-2h2v2h3v12H1z" opacity=".55"/>' +
    '</g>' +
    '<g fill="var(--surface)"><rect x="16" y="12" width="2" height="4" rx="1"/><rect x="16" y="20" width="2" height="4" rx="1"/><path d="M14.5 40v-5a2.5 2.5 0 0 1 5 0v5z"/></g>' +
    '</svg>';
})();
