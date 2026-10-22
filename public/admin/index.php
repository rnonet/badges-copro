<?php
declare(strict_types=1);
require __DIR__ . '/../../src/page.php';
$p = page_context();
?>
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Administration — <?= e($p['residence']) ?></title>
<link rel="stylesheet" href="../assets/app.css">
</head>
<body class="admin">
<header class="site-header">
  <div class="inner">
    <span id="logo"></span>
    <div class="site-title">
      <h1>Badges d'accès — administration</h1>
      <p id="residence-name"><?= e($p['residence']) ?></p>
    </div>
    <button type="button" class="btn btn-ghost btn-sm" id="btn-logout" hidden>Déconnexion</button>
  </div>
</header>

<main>
  <!-- Connexion -->
  <section id="view-login" hidden>
    <div class="card login-card">
      <div class="card-head"><h2>Connexion</h2></div>
      <div class="alert alert-error" id="login-error" role="alert" hidden></div>
      <form id="form-login" novalidate>
        <div class="field">
          <label for="in-password">Mot de passe administrateur</label>
          <input id="in-password" type="password" autocomplete="current-password" required>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Se connecter</button>
      </form>
    </div>
  </section>

  <!-- Tableau de bord -->
  <section id="view-dash" hidden>
    <div class="tabs" role="tablist" aria-label="Sections">
      <button type="button" role="tab" id="tab-btn-decl" aria-controls="tab-decl" aria-selected="true">Déclarations</button>
      <button type="button" role="tab" id="tab-btn-central" aria-controls="tab-central" aria-selected="false">Centrale actuelle <span class="tab-count" id="central-count"></span></button>
      <button type="button" role="tab" id="tab-btn-lots" aria-controls="tab-lots" aria-selected="false">Lots <span class="tab-count" id="lots-count"></span></button>
      <button type="button" role="tab" id="tab-btn-match" aria-controls="tab-match" aria-selected="false">Rapprochement <span class="tab-count" id="match-count"></span></button>
    </div>
    <div id="tab-decl" role="tabpanel" aria-labelledby="tab-btn-decl">
    <div class="stats" id="stats"></div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Rechercher : lot, nom, n° de badge, email…" aria-label="Rechercher">
      <select id="f-stair" aria-label="Filtrer par accès">
        <option value="">Tous accès</option>
        <option value="a">Escalier A</option>
        <option value="b">Escalier B</option>
        <option value="c">Escalier C</option>
        <option value="parking">Télécommande de parking</option>
      </select>
      <select id="f-check" aria-label="Filtrer par contrôle syndic">
        <option value="">Tous contrôles</option>
        <option value="verify">À vérifier</option>
        <option value="ok">Conformes</option>
      </select>
      <select id="f-occ" aria-label="Filtrer par occupant">
        <option value="">Tous occupants</option>
        <option value="coproprietaire">Copropriétaires</option>
        <option value="locataire">Locataires</option>
      </select>
      <div class="actions">
        <button type="button" class="btn btn-primary" id="btn-export">Exporter en CSV</button>
        <button type="button" class="btn btn-secondary" id="btn-new-decl">+ Déclaration</button>
      </div>
    </div>
    <p class="muted" id="result-count" style="font-size:14px;margin:0 0 10px"></p>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Lot</th><th>Nom</th><th>Id. syndic</th><th>N° de badge</th><th>Accès</th><th>Occupant</th><th>Locataire</th><th>Contact</th><th>Selon le syndic</th><th>Saisi le</th><th></th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <p class="empty" id="rows-empty" hidden>Aucun badge ne correspond.</p>
    </div>
    </div>

    <!-- Liste de la centrale actuelle : visible seulement ici (conseil syndical, syndic) -->
    <div id="tab-central" role="tabpanel" aria-labelledby="tab-btn-central" hidden>
      <div class="central-empty card" id="central-empty" hidden>
        <div class="card-head"><h2>Aucune liste importée<span class="sub">Importez l’export de la centrale d’accès actuelle (Nom, Identifiant, Code série).</span></h2></div>
        <button type="button" class="btn btn-primary" data-open-import>Importer la liste</button>
      </div>
      <div id="central-main" hidden>
        <p class="hint" id="central-meta" style="margin:0 0 12px"></p>
        <div class="stats" id="central-stats"></div>
        <div class="toolbar">
          <input type="search" id="cq" placeholder="Rechercher : nom, identifiant, code série…" aria-label="Rechercher dans la liste de la centrale">
          <select id="c-status" aria-label="Filtrer par statut">
            <option value="">Tous statuts</option>
            <option value="perdu">Plus en possession</option>
            <option value="non_declare">Non déclarés</option>
            <option value="declare">Déclarés</option>
            <option value="pas_a_moi">Refusés par le résident</option>
            <option value="sans_numero">Sans numéro</option>
            <option value="duplicate">Numéros en double</option>
          </select>
          <div class="actions">
            <button type="button" class="btn btn-primary" id="btn-central-export">Télécharger la liste (CSV)</button>
            <button type="button" class="btn btn-secondary" data-open-import>Mettre à jour (nouvel import)</button>
          </div>
        </div>
        <p class="muted" id="central-result" style="font-size:14px;margin:0 0 10px"></p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Nom</th><th>Identifiant</th><th>Code série</th><th>Statut</th><th>Détail</th><th>Date</th></tr></thead>
            <tbody id="central-rows"></tbody>
          </table>
          <p class="empty" id="central-rows-empty" hidden>Aucun badge ne correspond.</p>
        </div>
      </div>
    </div>

    <!-- Liste des lots et de leurs copropriétaires -->
    <div id="tab-lots" role="tabpanel" aria-labelledby="tab-btn-lots" hidden>
      <div class="card" id="lots-empty" hidden>
        <div class="card-head"><h2>Aucune liste de lots<span class="sub">Importez l’export JSON du syndic, ou ajoutez les lots un par un.</span></h2></div>
        <div class="actions">
          <button type="button" class="btn btn-primary" data-open-lots-import>Importer la liste</button>
          <button type="button" class="btn btn-secondary" data-add-lot>+ Ajouter un lot</button>
        </div>
      </div>
      <div id="lots-main" hidden>
        <div class="stats" id="lots-stats"></div>
        <div class="toolbar">
          <input type="search" id="lq" placeholder="Rechercher : lot, nom, prénom, identifiant…" aria-label="Rechercher un lot">
          <select id="l-type" aria-label="Filtrer par type de lot"><option value="">Tous types</option></select>
          <div class="actions">
            <button type="button" class="btn btn-secondary" data-add-lot>+ Ajouter un lot</button>
            <button type="button" class="btn btn-secondary" id="btn-lots-export">Télécharger (CSV)</button>
            <button type="button" class="btn btn-secondary" data-open-lots-import>Mettre à jour (import)</button>
          </div>
        </div>
        <div class="lots-viewbar">
          <div class="seg" role="group" aria-label="Affichage de la liste">
            <button type="button" data-view="owner" aria-pressed="true"><span class="l-long">Par copropriétaire</span><span class="l-short">Copropriétaire</span></button>
            <button type="button" data-view="login" aria-pressed="false"><span class="l-long">Par identifiant syndic</span><span class="l-short">Identifiant</span></button>
            <button type="button" data-view="flat" aria-pressed="false"><span class="l-long">Tous les lots</span><span class="l-short">Tous</span></button>
          </div>
          <p class="muted" id="lots-result" style="font-size:14px;margin:0"></p>
        </div>
        <div class="owner-groups" id="lots-groups"></div>
        <div class="table-wrap" id="lots-table-wrap" hidden>
          <table class="data lots-table">
            <thead><tr><th>Lot</th><th>Type</th><th>Nom</th><th>Prénom</th><th>Identifiant syndic</th><th>Déclarations</th><th></th></tr></thead>
            <tbody id="lots-rows"></tbody>
          </table>
        </div>
        <p class="empty" id="lots-rows-empty" hidden>Aucun lot ne correspond.</p>
      </div>
    </div>

    <!-- Rapprochement des noms de la centrale avec la liste du syndic -->
    <div id="tab-match" role="tabpanel" aria-labelledby="tab-btn-match" hidden>
      <div class="card" id="match-empty" hidden>
        <div class="card-head"><h2>Rapprochement impossible pour l’instant<span class="sub" id="match-empty-msg"></span></h2></div>
      </div>
      <div id="match-main" hidden>
        <p class="lede" style="margin:0 0 14px">Associez chaque nom de la centrale à un copropriétaire de la liste du syndic. Une association validée permet de proposer le badge au bon résident quand il saisit son lot ou son identifiant syndic, même si les noms diffèrent.</p>
        <div class="stats" id="match-stats"></div>
        <div class="toolbar">
          <input type="search" id="mq" placeholder="Rechercher : nom, copropriétaire, lot, identifiant…" aria-label="Rechercher dans les rapprochements">
          <select id="m-filter" aria-label="Filtrer les rapprochements">
            <option value="todo">À traiter</option>
            <option value="sure">Propositions sûres</option>
            <option value="valide">Validés</option>
            <option value="rejete">Aucun copropriétaire</option>
            <option value="aucune">Sans proposition</option>
            <option value="">Tous</option>
          </select>
          <div class="actions">
            <button type="button" class="btn btn-primary" id="btn-match-bulk">Valider les correspondances sûres</button>
          </div>
        </div>
        <p class="muted" id="match-result" style="font-size:14px;margin:0 0 10px"></p>
        <div class="table-wrap">
          <table class="data match-table">
            <thead><tr><th>Nom dans la centrale</th><th>Code série</th><th>Copropriétaire (liste du syndic)</th><th>Décision</th></tr></thead>
            <tbody id="match-rows"></tbody>
          </table>
          <p class="empty" id="match-rows-empty" hidden>Rien à afficher avec ce filtre.</p>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:24px">
      <div class="card-head"><h2>Gestion<span class="sub">Fin de campagne</span></h2></div>
      <div class="actions">
        <button type="button" class="btn btn-danger" id="btn-purge">Purger toutes les déclarations</button>
      </div>
      <p class="hint" id="lots-status"></p>
    </div>
  </section>
</main>

<!-- Édition d'une déclaration -->
<dialog id="decl-dialog" aria-labelledby="decl-title">
  <form class="dlg" method="dialog" novalidate id="decl-form">
    <div class="dlg-head"><h2 id="decl-title">Déclaration</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">&times;</button></div>
    <div class="dlg-body">
      <div class="alert alert-error" id="decl-error" hidden></div>
      <div class="field" id="d-identity" style="margin:0"></div>
      <div class="grid-3" style="margin-bottom:16px">
        <div class="field" id="d-lot"><label for="dl-lot">N° de lot</label><input id="dl-lot" name="lot" type="text" inputmode="numeric" maxlength="4"></div>
        <div class="field" id="d-nom"><label for="dl-nom">Nom</label><input id="dl-nom" name="nom" type="text" maxlength="80"></div>
        <div class="field" id="d-id_syndic"><label for="dl-syn">Id. syndic</label><input id="dl-syn" name="id_syndic" type="text" class="mono" maxlength="10"></div>
      </div>
      <div class="field" id="d-email"><label for="dl-email">Email de contact <span class="opt">(facultatif)</span></label><input id="dl-email" name="email" type="email" maxlength="160"></div>
      <div class="field" id="d-reports" hidden>
        <span class="label">Réponses aux badges de la centrale</span>
        <ul class="report-list" id="decl-reports"></ul>
      </div>
      <div class="field" id="d-badges">
        <span class="label">Badges</span>
        <div class="badge-list" id="decl-badges"></div>
        <button type="button" class="btn btn-add" id="decl-add">+ Ajouter un badge</button>
      </div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="btn btn-danger" id="decl-delete">Supprimer</button>
      <button type="button" class="btn btn-ghost" data-close>Annuler</button>
      <button type="submit" class="btn btn-primary">Enregistrer</button>
    </div>
  </form>
</dialog>

<!-- Import de la liste de la centrale -->
<dialog id="central-dialog" aria-labelledby="central-title">
  <form class="dlg" method="dialog" novalidate id="central-form">
    <div class="dlg-head"><h2 id="central-title">Liste de la centrale actuelle</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">&times;</button></div>
    <div class="dlg-body">
      <p class="hint" style="margin:0 0 14px" id="central-current"></p>
      <div class="field">
        <label for="central-file">Fichier exporté de la centrale</label>
        <input id="central-file" type="file" accept=".txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values">
        <p class="hint">Texte tabulé ou CSV avec les colonnes <strong>Nom</strong>, <strong>Identifiant</strong> et <strong>Code série</strong> (ex. S-1A2B3C4D). La nouvelle liste remplace l’ancienne ; les réponses des résidents sont conservées, car elles sont rattachées aux codes série.</p>
      </div>
      <div class="field">
        <label for="central-text">…ou collez son contenu</label>
        <textarea id="central-text" rows="6" class="mono" style="text-transform:none" placeholder="Nom&#9;Identifiant&#9;Code Série"></textarea>
      </div>
      <div class="alert alert-error" id="central-error" hidden></div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="btn btn-ghost" data-close>Annuler</button>
      <button type="submit" class="btn btn-primary">Importer (remplace la liste)</button>
    </div>
  </form>
</dialog>

<!-- Modification d'un lot -->
<dialog id="lot-dialog" aria-labelledby="lot-title">
  <form class="dlg" method="dialog" novalidate id="lot-form">
    <div class="dlg-head"><h2 id="lot-title">Lot</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">&times;</button></div>
    <div class="dlg-body">
      <div class="alert alert-error" id="lot-error" hidden></div>
      <div class="grid-2">
        <div class="field" id="lf-numero"><label for="lt-numero">N° de lot</label><input id="lt-numero" name="numero" type="text" inputmode="numeric" maxlength="4" placeholder="0102"></div>
        <div class="field" id="lf-libelle"><label for="lt-libelle">Type <span class="opt">(facultatif)</span></label><input id="lt-libelle" name="libelle" type="text" maxlength="60" list="lot-types" placeholder="Appartement"><datalist id="lot-types"></datalist></div>
      </div>
      <div class="field" id="lf-login">
        <label for="lt-login">Identifiant syndic du copropriétaire <span class="opt">(facultatif)</span></label>
        <input id="lt-login" name="login" type="text" class="mono" maxlength="10" list="lot-logins" placeholder="C543210" autocomplete="off">
        <datalist id="lot-logins"></datalist>
        <p class="hint" id="lt-login-hint">Choisir un identifiant existant reprend le nom et le prénom de ce copropriétaire.</p>
      </div>
      <div class="grid-2">
        <div class="field" id="lf-nom"><label for="lt-nom">Nom</label><input id="lt-nom" name="nom" type="text" maxlength="80" autocapitalize="characters" style="text-transform:uppercase"></div>
        <div class="field" id="lf-prenom"><label for="lt-prenom">Prénom <span class="opt">(facultatif)</span></label><input id="lt-prenom" name="prenom" type="text" maxlength="80"></div>
      </div>
      <div class="alert alert-info" id="lt-propagate" hidden></div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="btn btn-danger" id="lot-delete">Supprimer</button>
      <button type="button" class="btn btn-ghost" data-close>Annuler</button>
      <button type="submit" class="btn btn-primary">Enregistrer</button>
    </div>
  </form>
</dialog>

<!-- Lots -->
<dialog id="lots-dialog" aria-labelledby="lots-title">
  <form class="dlg" method="dialog" novalidate id="lots-form">
    <div class="dlg-head"><h2 id="lots-title">Liste des lots</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">&times;</button></div>
    <div class="dlg-body">
      <p class="hint" style="margin:0 0 14px" id="lots-current"></p>
      <div class="field">
        <label for="lots-file">Fichier JSON ou CSV</label>
        <input id="lots-file" type="file" accept=".json,application/json,.csv,text/csv,text/plain">
        <p class="hint"><strong>Export JSON du syndic</strong> (liste des copropriétaires avec leurs lots) : les numéros de lot, leur type, le nom et l'identifiant de chaque copropriétaire sont repris pour contrôler les déclarations. Les adresses, emails et téléphones du fichier sont ignorés.<br>Ou un <strong>CSV</strong> avec les colonnes <code>numero ; type ; nom ; prenom ; identifiant_syndic</code> (le format du bouton « Télécharger ») : téléchargez la liste, corrigez-la dans Excel, puis réimportez-la. Un CSV avec seulement les numéros de lot fonctionne aussi.<br><strong>L’import remplace toute la liste</strong>, y compris les modifications faites ici.</p>
      </div>
      <div class="field">
        <label for="lots-text">…ou collez son contenu</label>
        <textarea id="lots-text" rows="6" class="mono" placeholder="1;Appartement RDC droite&#10;2;Appartement RDC gauche&#10;3"></textarea>
      </div>
      <div class="alert alert-error" id="lots-error" hidden></div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="btn btn-danger" id="lots-clear">Vider la liste</button>
      <button type="button" class="btn btn-ghost" data-close>Annuler</button>
      <button type="submit" class="btn btn-primary">Importer (remplace la liste)</button>
    </div>
  </form>
</dialog>

<!-- Purge -->
<dialog id="purge-dialog" aria-labelledby="purge-title">
  <form class="dlg" method="dialog" novalidate id="purge-form">
    <div class="dlg-head"><h2 id="purge-title">Purger les déclarations</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">&times;</button></div>
    <div class="dlg-body">
      <div class="alert alert-warn">Toutes les déclarations et tous les badges seront <strong>définitivement supprimés</strong>. Exportez d'abord le CSV et remettez-le au gardien.</div>
      <div class="field"><label for="purge-confirm">Tapez <strong>PURGER</strong> pour confirmer</label><input id="purge-confirm" type="text" autocomplete="off" autocapitalize="characters"></div>
      <div class="alert alert-error" id="purge-error" hidden></div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="btn btn-ghost" data-close>Annuler</button>
      <button type="submit" class="btn btn-danger" style="background:var(--danger);color:#fff">Purger définitivement</button>
    </div>
  </form>
</dialog>

<script>window.API_URL = '../api.php';</script>
<?= boot_script($p['boot']) ?>
<script src="../assets/shared.js"></script>
<script src="../assets/admin.js"></script>
</body>
</html>
