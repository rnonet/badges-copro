<?php
/**
 * Diagnostic d'installation — à ouvrir dans le navigateur : https://votre-site/diagnostic.php
 *
 * Vérifie la version de PHP, les extensions, config.php, le dossier data/, la base de données,
 * l'API et l'envoi d'emails. Sans mot de passe : seulement des voyants (aucun détail).
 * Avec le mot de passe administrateur (celui de config.php) : messages d'erreur complets
 * et envoi d'un email de test.
 *
 * Écrit volontairement sans syntaxe récente : il doit pouvoir s'exécuter même sur un PHP
 * trop ancien, pour le signaler.
 */
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
header('X-Frame-Options: DENY');

$root = dirname(__DIR__);
$checks = array();   // [titre, état ok|warn|ko, message, détail réservé à l'administrateur]
$configFile = getenv('BADGES_CONFIG') ? getenv('BADGES_CONFIG') : $root . '/config.php';
$cfg = null;
$authed = false;
$mailResult = null;

function add_check(&$checks, $title, $state, $msg, $detail = '')
{
    $checks[] = array($title, $state, $msg, $detail);
}
function esc($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

/* ---------- 1. PHP ---------- */
$phpOk = version_compare(PHP_VERSION, '8.1.0', '>=');
add_check($checks, 'Version de PHP', $phpOk ? 'ok' : 'ko',
    $phpOk ? 'PHP ' . PHP_VERSION : 'PHP ' . PHP_VERSION . ' : il faut PHP 8.1 ou plus récent.',
    $phpOk ? '' : 'Chez OVH : le fichier .ovhconfig fourni à la racine du projet demande PHP 8.3 (à déposer à la racine de l\'hébergement). Ailleurs : choisir la version de PHP dans l\'espace client de l\'hébergeur.');

/* ---------- 2. config.php ---------- */
if (!is_file($configFile)) {
    add_check($checks, 'Fichier config.php', 'ko', 'Introuvable : copiez config.sample.php en config.php (à côté des dossiers public/, src/ et data/) puis remplissez-le.');
} else {
    try {
        $cfg = include $configFile;
    } catch (Throwable $e) {
        $cfg = null;
        add_check($checks, 'Fichier config.php', 'ko', 'Erreur de syntaxe dans config.php.', $e->getMessage() . ' (ligne ' . $e->getLine() . ')');
    }
    if (!is_array($cfg) && !array_filter($checks, function ($c) { return $c[0] === 'Fichier config.php'; })) {
        add_check($checks, 'Fichier config.php', 'ko', 'config.php ne renvoie pas la configuration : il doit commencer par « <?php return [ » (partez de config.sample.php).');
    }
    if (is_array($cfg)) {
        $missing = array();
        if (empty($cfg['admin_password_hash'])) $missing[] = 'admin_password_hash (mot de passe administrateur)';
        if (empty($cfg['contact_email'])) $missing[] = 'contact_email';
        add_check($checks, 'Fichier config.php', $missing ? 'warn' : 'ok',
            $missing ? 'Présent, mais à compléter : ' . implode(', ', $missing) . '.' : 'Présent et lisible.');
    }
}

/* ---------- Mot de passe : détails et email de test ---------- */
$pwd = isset($_POST['password']) ? (string) $_POST['password'] : '';
if ($pwd !== '' && is_array($cfg) && !empty($cfg['admin_password_hash'])) {
    $authed = password_verify($pwd, $cfg['admin_password_hash']);
    if (!$authed) {
        usleep(800000); // freine les essais
    }
}

/* ---------- 3. Extensions ---------- */
$driver = is_array($cfg) && isset($cfg['db_driver']) && $cfg['db_driver'] === 'mysql' ? 'mysql' : 'sqlite';
$need = array('pdo' => 'base de données', ($driver === 'mysql' ? 'pdo_mysql' : 'pdo_sqlite') => 'base ' . ($driver === 'mysql' ? 'MySQL' : 'SQLite'), 'mbstring' => 'textes accentués', 'json' => 'échanges avec le navigateur', 'openssl' => 'envoi des emails (SMTP)');
$optional = array('curl' => 'lecture des photos par Claude');
$miss = array();
foreach ($need as $ext => $why) {
    if (!extension_loaded($ext)) $miss[] = "$ext ($why)";
}
$missOpt = array();
foreach ($optional as $ext => $why) {
    if (!extension_loaded($ext)) $missOpt[] = "$ext ($why)";
}
add_check($checks, 'Extensions PHP', $miss ? 'ko' : ($missOpt ? 'warn' : 'ok'),
    $miss ? 'Manquantes : ' . implode(', ', $miss) . '.' : ($missOpt ? 'Facultative manquante : ' . implode(', ', $missOpt) . '.' : 'Toutes présentes.'));

/* ---------- 4. Dossier data/ ---------- */
$dataDir = $root . '/data';
if (!is_dir($dataDir)) {
    add_check($checks, 'Dossier data/', 'ko', 'Absent : créez un dossier data/ à côté de public/ et src/.');
} else {
    $probe = $dataDir . '/.ecriture-test';
    $w = @file_put_contents($probe, 'ok') !== false;
    if ($w) @unlink($probe);
    add_check($checks, 'Dossier data/', $w ? 'ok' : 'ko',
        $w ? 'Accessible en écriture.' : 'PHP ne peut pas y écrire : donnez-lui les droits d\'écriture (droits 755 ou 775 par FTP, selon l\'hébergeur).',
        $w ? '' : 'Chemin : ' . $dataDir);
}

/* ---------- 5. Base de données ---------- */
$dbInfo = null;
if ($phpOk && is_array($cfg) && !$miss) {
    try {
        require_once $root . '/src/bootstrap.php';
        $pdo = db();
        $counts = array();
        foreach (array('lots' => 'lots', 'declarations' => 'déclarations', 'badges' => 'badges', 'known_badges' => 'lignes de centrale') as $t => $label) {
            $counts[] = (int) $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn() . ' ' . $label;
        }
        $dbInfo = implode(', ', $counts);
        add_check($checks, 'Base de données', 'ok', ($driver === 'mysql' ? 'MySQL' : 'SQLite') . ' : connexion et tables en place (' . $dbInfo . ').');
    } catch (Throwable $e) {
        $hint = $driver === 'mysql'
            ? 'Vérifiez le bloc mysql de config.php (hôte, nom de la base, utilisateur, mot de passe). Si les tables n\'existent pas et que l\'utilisateur n\'a pas le droit de les créer, exécutez bin/schema-mysql.sql dans phpMyAdmin.'
            : 'Vérifiez que le dossier data/ est accessible en écriture (voir plus haut) et que db_path dans config.php pointe dans ce dossier.';
        add_check($checks, 'Base de données', 'ko', 'Connexion impossible. ' . $hint, get_class($e) . ' : ' . $e->getMessage());
    }
} else {
    add_check($checks, 'Base de données', 'ko', 'Non testée : corrigez d\'abord les points ci-dessus.');
}

/* ---------- 6. HTTPS ---------- */
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
$secure = !is_array($cfg) || !isset($cfg['secure_cookies']) || $cfg['secure_cookies'];
add_check($checks, 'HTTPS', $https ? 'ok' : ($secure ? 'ko' : 'warn'),
    $https ? 'Le site est servi en HTTPS.' : ($secure
        ? 'Le site est en HTTP alors que secure_cookies vaut true : le navigateur ne renverra pas la session (erreur « Session expirée »). Activez HTTPS (certificat Let\'s Encrypt gratuit chez la plupart des hébergeurs).'
        : 'Le site est en HTTP : acceptable pour un essai, mais activez HTTPS avant la mise en service (appareil photo, sécurité).'));

/* ---------- 7. Emails ---------- */
if (is_array($cfg)) {
    $t = isset($cfg['mail_transport']) ? $cfg['mail_transport'] : 'smtp';
    $smtpOk = $t !== 'smtp' || (!empty($cfg['smtp']['host']) && !empty($cfg['smtp']['username']) && !empty($cfg['smtp']['password']));
    add_check($checks, 'Envoi des emails', $t === 'log' ? 'warn' : ($smtpOk ? 'ok' : 'ko'),
        $t === 'log' ? 'mail_transport vaut « log » : les codes sont écrits dans data/mail.log au lieu d\'être envoyés. Passez à « smtp » pour la mise en service.'
        : ($smtpOk ? 'Configuré (' . $t . '). Utilisez l\'email de test ci-dessous pour vérifier.' : 'Bloc smtp incomplet dans config.php (hôte, identifiant, mot de passe).'));
}

/* ---------- Email de test (administrateur) ---------- */
if ($authed && !empty($_POST['test_email'])) {
    $to = trim((string) $_POST['test_email']);
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        $mailResult = array('ko', 'Adresse email non valide.');
    } elseif (!function_exists('config')) {
        $mailResult = array('ko', 'Test impossible : corrigez d\'abord les points en rouge.');
    } else {
        require_once $root . '/src/Mailer.php';
        $ok = Mailer::send($to, 'Test — déclaration des badges', "Bonjour,\n\nCet email confirme que l'envoi des codes de vérification fonctionne.\n\nLe conseil syndical");
        $mailResult = $ok ? array('ok', 'Email envoyé à ' . $to . '. Vérifiez la boîte de réception (et les indésirables).')
                          : array('ko', 'Échec de l\'envoi : ' . (Mailer::$lastError !== '' ? Mailer::$lastError : 'voir data/app.log.'));
    }
}

$hasKo = (bool) array_filter($checks, function ($c) { return $c[1] === 'ko'; });
$canAuth = is_array($cfg) && !empty($cfg['admin_password_hash']);
?>
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Diagnostic — badges</title>
<link rel="stylesheet" href="assets/app.css">
<style>
  .diag { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .diag li { display: grid; grid-template-columns: 28px 1fr; gap: 4px 10px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
  .diag .dot { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: #fff; margin-top: 1px; }
  .dot.ok { background: var(--green); } .dot.warn { background: #b7791f; } .dot.ko { background: var(--danger); }
  .diag strong { display: block; }
  .diag .detail { grid-column: 2; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; color: var(--muted); word-break: break-word; }
  .api-out { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<header class="site-header"><div class="inner"><div class="site-title"><h1>Diagnostic de l'installation</h1><p>Déclaration des badges d'accès</p></div></div></header>
<main>
  <div class="alert <?= $hasKo ? 'alert-error' : 'alert-success' ?>">
    <?= $hasKo ? 'Au moins un point bloque l\'application : corrigez les lignes en rouge, puis rechargez cette page.' : 'Tout est prêt côté serveur. Ouvrez l\'administration (admin/) pour importer les listes.' ?>
  </div>

  <div class="card">
    <div class="card-head"><h2>Vérifications<span class="sub"><?= $authed ? 'Détails techniques affichés.' : 'Saisissez le mot de passe administrateur plus bas pour voir le détail des erreurs.' ?></span></h2></div>
    <ul class="diag">
      <?php foreach ($checks as $c): ?>
        <li>
          <span class="dot <?= esc($c[1]) ?>" aria-hidden="true"><?= $c[1] === 'ok' ? '✓' : ($c[1] === 'warn' ? '!' : '✕') ?></span>
          <div><strong><?= esc($c[0]) ?></strong><?= esc($c[2]) ?></div>
          <?php if ($c[3] !== '' && ($authed || $c[0] === 'Version de PHP')): ?><div class="detail"><?= esc($c[3]) ?></div><?php endif; ?>
        </li>
      <?php endforeach; ?>
      <li>
        <span class="dot warn" id="api-dot" aria-hidden="true">…</span>
        <div><strong>API (api.php)</strong><span id="api-msg">Test en cours…</span></div>
        <div class="detail api-out" id="api-detail" hidden></div>
      </li>
    </ul>
  </div>

  <div class="card">
    <div class="card-head"><h2>Détails et email de test<span class="sub">Réservé à l'administrateur (mot de passe défini dans config.php).</span></h2></div>
    <?php if (!$canAuth): ?>
      <p class="hint" style="margin:0">Définissez d'abord <code>admin_password_hash</code> dans config.php : <code>php bin/hash-password.php "votre mot de passe"</code>.</p>
    <?php else: ?>
      <?php if ($pwd !== '' && !$authed): ?><div class="alert alert-error">Mot de passe incorrect.</div><?php endif; ?>
      <?php if ($mailResult): ?><div class="alert <?= $mailResult[0] === 'ok' ? 'alert-success' : 'alert-error' ?>"><?= esc($mailResult[1]) ?></div><?php endif; ?>
      <form method="post" autocomplete="off">
        <div class="field"><label for="password">Mot de passe administrateur</label><input id="password" name="password" type="password" required autocomplete="current-password"></div>
        <div class="field"><label for="test_email">Envoyer un email de test à <span class="opt">(facultatif)</span></label><input id="test_email" name="test_email" type="email" placeholder="vous@exemple.fr" value="<?= esc(isset($_POST['test_email']) ? $_POST['test_email'] : '') ?>"></div>
        <button type="submit" class="btn btn-primary">Vérifier</button>
      </form>
    <?php endif; ?>
  </div>

  <div class="card">
    <div class="card-head"><h2>Ensuite</h2></div>
    <ol style="margin:0;padding-left:20px;display:grid;gap:6px">
      <li>Ouvrez <a href="admin/">l'administration</a> et connectez-vous.</li>
      <li>Onglet <strong>Lots</strong> : « Mettre à jour (import) » avec l'export JSON du syndic.</li>
      <li>Onglet <strong>Centrale actuelle</strong> : importez la liste exportée de la centrale.</li>
      <li>Onglet <strong>Rapprochement</strong> : validez les correspondances sûres, puis traitez les autres.</li>
      <li>Faites une déclaration d'essai sur <a href="./">la page des résidents</a> avec votre email, puis modifiez-la avec le code reçu.</li>
      <li>Diffusez le lien aux résidents. Cette page peut rester en ligne (elle ne montre rien sans mot de passe) ou être supprimée.</li>
    </ol>
  </div>
</main>
<script>
(async function () {
  const dot = document.getElementById('api-dot'), msg = document.getElementById('api-msg'), det = document.getElementById('api-detail');
  const set = (state, text, detail) => {
    dot.className = 'dot ' + state; dot.textContent = state === 'ok' ? '✓' : state === 'warn' ? '!' : '✕';
    msg.textContent = text;
    if (detail) { det.textContent = detail; det.hidden = false; }
  };
  try {
    const res = await fetch('api.php?action=session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* réponse non JSON */ }
    if (res.ok && json && json.ok) set('ok', 'Répond correctement.');
    else if (res.status === 404) set('ko', 'api.php introuvable (erreur 404) : vérifiez que la racine du site pointe sur public/, ou que le .htaccess / index.php de la racine sont bien déposés.');
    else if (json && json.error) set('ko', 'Erreur renvoyée : ' + json.error + ' (code ' + res.status + '). Voir les lignes en rouge ci-dessus et data/app.log.');
    else set('ko', 'Réponse inattendue (code ' + res.status + ') : souvent une erreur PHP. Voir data/app.log ou le journal d’erreurs de l’hébergeur.', <?= $authed ? 'text.slice(0, 600)' : "''" ?>);
  } catch (e) {
    set('ko', 'Impossible de joindre api.php : ' + e.message);
  }
})();
</script>
</body>
</html>
