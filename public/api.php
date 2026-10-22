<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/Mailer.php';
require __DIR__ . '/../src/Ocr.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

start_session();

function out(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400, array $extra = []): never
{
    out(['ok' => false, 'error' => $message] + $extra, $status);
}

function body(): array
{
    static $b = null;
    if ($b === null) {
        $raw = file_get_contents('php://input', false, null, 0, 12_000_000);
        $b = json_decode($raw ?: '[]', true) ?: [];
    }
    return $b;
}

function require_csrf(): void
{
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_GET['csrf'] ?? '');
    if (!hash_equals($_SESSION['csrf'], (string) $token)) {
        fail('Session expirée, rechargez la page.', 419);
    }
}

function require_admin(): void
{
    if (empty($_SESSION['admin']) || ($_SESSION['admin_seen'] ?? 0) < time() - 7200) {
        unset($_SESSION['admin']);
        fail('Connexion administrateur requise.', 401);
    }
    $_SESSION['admin_seen'] = time();
}

function resident_email(): ?string
{
    return $_SESSION['resident_email'] ?? null;
}

function public_declarations(string $email): array
{
    return array_map('public_declaration', load_declarations('email = ?', [$email]));
}

/** Déclaration dont le visiteur peut voir / modifier les données (résident vérifié ou administrateur) */
function owned_declaration_id($id): ?int
{
    $id = (int) $id;
    if (!$id) {
        return null;
    }
    if (!empty($_SESSION['admin'])) {
        return $id;
    }
    $st = db()->prepare('SELECT email FROM declarations WHERE id = ?');
    $st->execute([$id]);
    $em = $st->fetchColumn();
    return $em && $em === resident_email() ? $id : null;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST' && !in_array($action, ['admin_export', 'admin_central_export', 'admin_lots_export'], true)) {
    fail('Méthode non autorisée.', 405);
}
if ($action !== 'session') {
    require_csrf();
}

try {
    switch ($action) {

        /* ------------------------------------------------------------ Public */

        case 'session':
            out(session_payload());

        case 'suggest_badges':
            // Badges de l'ancienne centrale qui semblent appartenir au résident : numéros masqués
            if (!rate_limit('suggest:' . client_ip(), 60, 600)) {
                fail('Trop de recherches, patientez quelques minutes.', 429);
            }
            $in = body();
            $list = central_suggestions($in, owned_declaration_id($in['declaration_id'] ?? 0));
            out(['ok' => true, 'suggestions' => array_map(fn($s) => ['token' => $s['token'], 'hint' => $s['hint']], $list)]);

        case 'check_serial':
            if (!rate_limit('check:' . client_ip(), 120, 600)) {
                fail('Trop de vérifications, patientez quelques minutes.', 429);
            }
            $serial = normalize_serial((string) (body()['serial'] ?? ''));
            if ($e = serial_error($serial)) {
                out(['ok' => true, 'serial' => $serial, 'valid' => false, 'message' => $e]);
            }
            $ignore = null;
            $declId = (int) (body()['declaration_id'] ?? 0);
            if ($declId) {
                $own = db()->prepare('SELECT email FROM declarations WHERE id = ?');
                $own->execute([$declId]);
                $em = $own->fetchColumn();
                if (!empty($_SESSION['admin']) || ($em && $em === resident_email())) {
                    $ignore = $declId;
                }
            }
            $taken = serial_taken($serial, $ignore);
            out(['ok' => true, 'serial' => $serial, 'valid' => !$taken, 'message' => $taken ? 'Ce badge est déjà déclaré.' : null]);

        case 'submit':
            $in = body();
            if (!empty($in['website'])) { // champ piège anti-robot
                out(['ok' => true, 'declaration_id' => 0]);
            }
            if (!rate_limit('submit:' . client_ip(), 30, 3600)) {
                fail('Trop d’envois depuis cette connexion, réessayez plus tard.', 429);
            }
            if (empty($in['consent'])) {
                throw new ValidationError(['consent' => 'Merci de prendre connaissance de la notice et de cocher la case.']);
            }
            $declId = (int) ($in['declaration_id'] ?? 0) ?: null;
            if ($declId) {
                $st = db()->prepare('SELECT email FROM declarations WHERE id = ?');
                $st->execute([$declId]);
                $owner = $st->fetchColumn();
                if (!$owner || $owner !== resident_email()) {
                    fail('Vous ne pouvez pas modifier cette déclaration. Demandez un code de vérification.', 403);
                }
            }
            [$identity, $badges, $reports] = validate_all($in, $declId, central_token_map($in, $declId));
            $id = save_declaration($declId, $identity, $badges, $reports);
            if ($identity['email'] && resident_email() && $identity['email'] !== resident_email()) {
                // l'email a changé : la session suit la nouvelle adresse seulement si elle a déjà été vérifiée
                unset($_SESSION['resident_email']);
            }
            $decl = public_declaration(load_declarations('id = ?', [$id])[0]);
            out(['ok' => true, 'declaration' => $decl]);

        case 'request_code':
            $email = strtolower(clean_text(body()['email'] ?? '', 160));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new ValidationError(['email' => "L'adresse email n'est pas valide."]);
            }
            if (!rate_limit('code-ip:' . client_ip(), 10, 3600)) {
                fail('Trop de demandes de code, réessayez dans une heure.', 429);
            }
            $generic = ['ok' => true, 'message' => "Si une déclaration est associée à $email, un code vient d'y être envoyé. Pensez à regarder dans les indésirables."];
            $st = db()->prepare('SELECT last_sent_at FROM auth_codes WHERE email = ?');
            $st->execute([$email]);
            $last = (int) $st->fetchColumn();
            if ($last && time() - $last < 60) {
                fail('Un code vient d’être envoyé. Attendez une minute avant d’en demander un autre.', 429);
            }
            $exists = db()->prepare('SELECT 1 FROM declarations WHERE email = ? LIMIT 1');
            $exists->execute([$email]);
            if ($exists->fetchColumn()) {
                $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
                db()->prepare('REPLACE INTO auth_codes (email, code_hash, expires_at, attempts, last_sent_at) VALUES (?,?,?,0,?)')
                    ->execute([$email, password_hash($code, PASSWORD_DEFAULT), time() + 900, time()]);
                $name = config('residence_name');
                $sent = Mailer::send($email, "Votre code : $code", "Bonjour,\n\nVoici votre code pour modifier votre déclaration de badges ($name) :\n\n    $code\n\nIl est valable 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nLe conseil syndical");
                if (!$sent) {
                    fail("L'email n'a pas pu être envoyé. Réessayez plus tard ou contactez le conseil syndical.", 502);
                }
            }
            out($generic);

        case 'verify_code':
            $email = strtolower(clean_text(body()['email'] ?? '', 160));
            $code = preg_replace('/\D/', '', (string) (body()['code'] ?? ''));
            $st = db()->prepare('SELECT * FROM auth_codes WHERE email = ?');
            $st->execute([$email]);
            $row = $st->fetch();
            if (!$row || (int) $row['expires_at'] < time()) {
                fail('Code expiré ou inconnu. Demandez un nouveau code.', 400, ['expired' => true]);
            }
            if ((int) $row['attempts'] >= 5) {
                db()->prepare('DELETE FROM auth_codes WHERE email = ?')->execute([$email]);
                fail('Trop d’essais. Demandez un nouveau code.', 400, ['expired' => true]);
            }
            if (!password_verify($code, $row['code_hash'])) {
                db()->prepare('UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ?')->execute([$email]);
                $left = 4 - (int) $row['attempts'];
                fail($left > 0 ? "Code incorrect. Encore $left essai(s)." : 'Code incorrect.', 400);
            }
            db()->prepare('DELETE FROM auth_codes WHERE email = ?')->execute([$email]);
            session_regenerate_id(true);
            $_SESSION['resident_email'] = $email;
            out(['ok' => true, 'email' => $email, 'declarations' => public_declarations($email)]);

        case 'my_declarations':
            if (!resident_email()) {
                fail('Vérification par code requise.', 401);
            }
            out(['ok' => true, 'email' => resident_email(), 'declarations' => public_declarations(resident_email())]);

        case 'delete_declaration':
            $id = (int) (body()['id'] ?? 0);
            $st = db()->prepare('DELETE FROM declarations WHERE id = ? AND email = ?');
            $st->execute([$id, resident_email() ?? '']);
            if (!$st->rowCount()) {
                fail('Déclaration introuvable.', 404);
            }
            out(['ok' => true]);

        case 'resident_logout':
            unset($_SESSION['resident_email']);
            out(['ok' => true]);

        case 'ocr':
            if (!Ocr::enabled()) {
                out(['ok' => true, 'mode' => 'local']);
            }
            if (!rate_limit('ocr:' . client_ip(), (int) config('ocr_max_per_hour'), 3600)) {
                fail('Limite de lectures photo atteinte pour l’heure. Saisissez le numéro à la main.', 429);
            }
            $dataUrl = (string) (body()['image'] ?? '');
            if (!preg_match('#^data:(image/(?:jpeg|png|webp));base64,(.+)$#s', $dataUrl, $m)) {
                fail('Image non reconnue.');
            }
            $bytes = base64_decode($m[2], true);
            unset($dataUrl);
            if ($bytes === false || strlen($bytes) > 5_000_000) {
                fail('Image trop lourde ou illisible.');
            }
            if (@getimagesizefromstring($bytes) === false) {
                fail('Le fichier n’est pas une image.');
            }
            $res = Ocr::read($bytes, $m[1]);
            unset($bytes);
            out(['ok' => true, 'mode' => 'server'] + $res);

        /* ------------------------------------------------------------ Admin */

        case 'admin_login':
            if (!rate_limit('admin-login:' . client_ip(), 8, 900)) {
                fail('Trop de tentatives. Réessayez dans 15 minutes.', 429);
            }
            $hash = (string) config('admin_password_hash');
            if ($hash === '' || !password_verify((string) (body()['password'] ?? ''), $hash)) {
                usleep(400_000);
                fail('Mot de passe incorrect.', 401);
            }
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            $_SESSION['admin_seen'] = time();
            out(['ok' => true]);

        case 'admin_logout':
            unset($_SESSION['admin'], $_SESSION['admin_seen']);
            out(['ok' => true]);

        case 'admin_list':
            require_admin();
            $decls = load_declarations();
            $idx = syndic_index();
            $central = central_names_by_serial();
            $centralLoaded = (bool) $central;
            foreach ($decls as &$d) {
                $d['syndic_check'] = syndic_check($d, $idx);
                foreach ($d['badges'] as &$b) {
                    $b['central_names'] = $centralLoaded ? ($central[$b['serial']] ?? []) : null;
                }
                unset($b);
                foreach ($d['reports'] as &$r) {
                    $r['central_names'] = $central[$r['serial']] ?? [];
                }
                unset($r);
            }
            unset($d);
            $lotsCount = (int) db()->query('SELECT COUNT(*) FROM lots')->fetchColumn();
            out(['ok' => true, 'declarations' => $decls, 'lots_count' => $lotsCount, 'owners_count' => count($idx['byLogin'])]);

        case 'admin_save_declaration':
            require_admin();
            $in = body();
            $id = (int) ($in['declaration_id'] ?? 0) ?: null;
            [$identity, $badges] = validate_all($in, $id, null, true);
            $id = save_declaration($id, $identity, $badges);
            out(['ok' => true, 'declaration' => load_declarations('id = ?', [$id])[0]]);

        case 'admin_delete_badge':
            require_admin();
            $id = (int) (body()['id'] ?? 0);
            $st = db()->prepare('SELECT declaration_id FROM badges WHERE id = ?');
            $st->execute([$id]);
            $declId = $st->fetchColumn();
            db()->prepare('DELETE FROM badges WHERE id = ?')->execute([$id]);
            if ($declId) { // une déclaration sans badge n'a plus de sens
                $left = db()->prepare('SELECT (SELECT COUNT(*) FROM badges WHERE declaration_id = ?) + (SELECT COUNT(*) FROM known_reports WHERE declaration_id = ?)');
                $left->execute([$declId, $declId]);
                if (!(int) $left->fetchColumn()) {
                    db()->prepare('DELETE FROM declarations WHERE id = ?')->execute([$declId]);
                }
            }
            out(['ok' => true]);

        case 'admin_delete_declaration':
            require_admin();
            db()->prepare('DELETE FROM declarations WHERE id = ?')->execute([(int) (body()['id'] ?? 0)]);
            out(['ok' => true]);

        case 'admin_import_lots':
            require_admin();
            $lots = parse_lots((string) (body()['csv'] ?? ''));
            if (!$lots) {
                fail('Aucun numéro de lot reconnu. Fournissez l’export JSON du syndic, ou un CSV dont la première colonne contient les numéros de lot.');
            }
            $owners = replace_lots($lots);
            out(['ok' => true, 'count' => count($lots), 'owners' => $owners]);

        case 'admin_lots_list':
            require_admin();
            out(['ok' => true, 'rows' => lots_rows()]);

        case 'admin_lot_save':
            // Ajout ou modification d'un lot ; le nom suit l'identifiant syndic sur tous les lots du copropriétaire
            require_admin();
            $in = body();
            $orig = normalize_lot((string) ($in['original_numero'] ?? ''));
            $num = normalize_lot((string) ($in['numero'] ?? ''));
            $errors = [];
            if (!preg_match('/^\d{1,4}$/', $num) || (int) $num === 0) {
                $errors['numero'] = 'Le numéro de lot comporte 1 à 4 chiffres (ex. 0102).';
            }
            $login = strtoupper(clean_text($in['login'] ?? '', 20));
            if ($login !== '' && !preg_match(config('syndic_id_pattern'), $login)) {
                $errors['login'] = "L'identifiant syndic est une lettre suivie de 6 chiffres (ex. C543210).";
            }
            $last = mb_strtoupper(clean_text($in['nom'] ?? '', 80));
            $first = clean_text($in['prenom'] ?? '', 80);
            if ($login !== '' && $last === '') {
                $errors['nom'] = 'Indiquez le nom du copropriétaire.';
            }
            $exists = db()->prepare('SELECT 1 FROM lots WHERE numero = ?');
            $exists->execute([$num]);
            if (!$errors && $num !== $orig && $exists->fetchColumn()) {
                $errors['numero'] = 'Ce numéro de lot existe déjà.';
            }
            if ($errors) {
                throw new ValidationError($errors);
            }
            $rec = lot_record(clean_text($in['libelle'] ?? '', 60) ?: null, $last, $first, $login ?: null);
            $pdo = db();
            $pdo->beginTransaction();
            if ($orig !== '') {
                $pdo->prepare('DELETE FROM lots WHERE numero = ?')->execute([$orig]);
            }
            $pdo->prepare('INSERT INTO lots (numero, libelle, owner_lastname, owner_firstname, owner_name, owner_login) VALUES (?,?,?,?,?,?)')
                ->execute([$num, $rec['libelle'], $rec['owner_lastname'], $rec['owner_firstname'], $rec['owner_name'], $rec['owner_login']]);
            $others = 0;
            if ($login !== '') {
                $st = $pdo->prepare('UPDATE lots SET owner_lastname = ?, owner_firstname = ?, owner_name = ? WHERE owner_login = ? AND numero != ?');
                $st->execute([$rec['owner_lastname'], $rec['owner_firstname'], $rec['owner_name'], $login, $num]);
                $others = $st->rowCount();
            }
            $pdo->commit();
            out(['ok' => true, 'numero' => $num, 'others_updated' => $others]);

        case 'admin_lot_delete':
            require_admin();
            db()->prepare('DELETE FROM lots WHERE numero = ?')->execute([normalize_lot((string) (body()['numero'] ?? ''))]);
            out(['ok' => true]);

        case 'admin_lots_export':
            require_admin();
            header_remove('Content-Type');
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="lots_' . date('Y-m-d') . '.csv"');
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['numero', 'type', 'nom', 'prenom', 'identifiant_syndic'], ';', '"', '\\');
            foreach (lots_rows() as $r) {
                fputcsv($out, array_map(fn($v) => ($v !== null && $v !== '' && in_array($v[0], ['=', '+', '-', '@'], true)) ? "'" . $v : (string) $v,
                    [$r['numero'], $r['libelle'], $r['nom'], $r['prenom'], $r['login']]), ';', '"', '\\');
            }
            fclose($out);
            exit;

        case 'admin_clear_lots':
            require_admin();
            db()->exec('DELETE FROM lots');
            out(['ok' => true]);

        case 'admin_central_list':
            require_admin();
            $rows = central_rows();
            $known = array_flip(array_filter(array_column($rows, 'serial')));
            $outside = 0;
            foreach (db()->query('SELECT serial FROM badges') as $b) {
                if (!isset($known[$b['serial']])) {
                    $outside++;
                }
            }
            out(['ok' => true, 'rows' => $rows, 'declared_outside' => $known ? $outside : null,
                 'imported_at' => $rows ? (db()->query("SELECT value FROM settings WHERE k = 'central_imported_at'")->fetchColumn() ?: null) : null]);

        case 'admin_import_central':
            require_admin();
            $rows = parse_central((string) (body()['content'] ?? ''));
            if (!$rows) {
                fail('Aucune ligne reconnue. Le fichier doit contenir les colonnes Nom, Identifiant et Code série (texte tabulé ou CSV).');
            }
            $withSerial = count(array_filter(array_column($rows, 'serial')));
            if (!$withSerial) {
                fail('Aucun code série reconnu dans ce fichier. Vérifiez qu’il s’agit bien de l’export de la centrale.');
            }
            $pdo = db();
            $pdo->beginTransaction();
            $pdo->exec('DELETE FROM known_badges');
            $ins = $pdo->prepare('INSERT INTO known_badges (position, name, identifiant, raw_serial, serial) VALUES (?,?,?,?,?)');
            foreach ($rows as $i => $r) {
                $ins->execute([$i, $r['name'], $r['identifiant'], $r['raw_serial'], $r['serial']]);
            }
            $pdo->prepare("REPLACE INTO settings (k, value) VALUES ('central_imported_at', ?)")->execute([now()]);
            $pdo->commit();
            out(['ok' => true, 'count' => count($rows), 'with_serial' => $withSerial]);

        case 'admin_matching_list':
            require_admin();
            $owners = array_values(array_map(fn($o) => ['login' => $o['login'], 'name' => $o['name'], 'lots' => $o['lots']], owners_index()));
            out(['ok' => true, 'rows' => matching_rows(), 'owners' => $owners, 'central_loaded' => central_loaded()]);

        case 'admin_match_decide':
            require_admin();
            $in = body();
            $action = (string) ($in['action'] ?? '');
            if (!in_array($action, ['valider', 'rejeter', 'reset'], true) || !is_string($in['key'] ?? null)) {
                fail('Action de rapprochement inconnue.');
            }
            save_match_decision($in['key'], $action, isset($in['login']) ? strtoupper(clean_text($in['login'], 20)) : null);
            out(['ok' => true]);

        case 'admin_match_bulk':
            // Valide d'un coup les correspondances sûres encore en attente
            require_admin();
            $n = 0;
            db()->beginTransaction();
            foreach (matching_rows() as $r) {
                if ($r['level'] === 'sure' && !$r['decision']) {
                    save_match_decision($r['key'], 'valider', $r['candidates'][0]['login']);
                    $n++;
                }
            }
            db()->commit();
            out(['ok' => true, 'count' => $n]);

        case 'admin_central_export':
            require_admin();
            $ids = array_filter(array_map('intval', explode(',', (string) ($_GET['ids'] ?? ''))));
            export_central_csv($ids);

        case 'admin_purge':
            require_admin();
            if ((body()['confirm'] ?? '') !== 'PURGER') {
                fail('Tapez PURGER pour confirmer.');
            }
            $pdo = db();
            $pdo->exec('DELETE FROM badges');
            $pdo->exec('DELETE FROM declarations');
            $pdo->exec('DELETE FROM auth_codes');
            if (db_driver() === 'sqlite') {
                $pdo->exec('VACUUM'); // récupère la place libérée dans le fichier
            }
            out(['ok' => true]);

        case 'admin_export':
            require_admin();
            $ids = array_filter(array_map('intval', explode(',', (string) ($_GET['ids'] ?? ''))));
            export_csv($ids);

        default:
            fail('Action inconnue.', 404);
    }
} catch (ValidationError $e) {
    out(['ok' => false, 'error' => 'Certaines informations sont à corriger.', 'errors' => $e->errors], 422);
} catch (Throwable $e) {
    error_log('badges api: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    fail($e instanceof RuntimeException && !($e instanceof PDOException) ? $e->getMessage() : 'Erreur interne, réessayez.', 500);
}

/** @param int[] $badgeIds liste vide = tous les badges */
function export_csv(array $badgeIds): never
{
    $fmt = fn(?string $d) => $d ? (new DateTimeImmutable($d))->format('d/m/Y H:i') : '';
    $cell = function ($v): string {
        $v = (string) $v;
        if ($v !== '' && in_array($v[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            $v = "'" . $v; // neutralise les formules Excel
        }
        return $v;
    };
    $occ = ['coproprietaire' => 'copropriétaire', 'locataire' => 'locataire'];

    header_remove('Content-Type');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="badges_' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['date_saisie', 'date_modification', 'lot', 'nom', 'identifiant_syndic', 'email_contact', 'numero_badge', 'escalier_A', 'escalier_B', 'escalier_C', 'telecommande_parking', 'occupant', 'locataire_nom', 'locataire_telephone', 'locataire_email', 'coproprietaire_selon_syndic', 'controle', 'centrale_actuelle'], ';', '"', '\\');
    $idx = syndic_index();
    $central = central_names_by_serial();
    foreach (load_declarations() as $d) {
        $chk = syndic_check($d, $idx);
        $owners = $chk ? implode(' / ', array_map(fn($o) => $o['name'] . ' (' . $o['login'] . ')', $chk['owners'])) : '';
        $control = $chk === null ? '' : ($chk['issues'] ? 'À vérifier : ' . implode(', ', $chk['issues']) : 'OK');
        foreach ($d['badges'] as $b) {
            if ($badgeIds && !in_array($b['id'], $badgeIds, true)) {
                continue;
            }
            fputcsv($out, array_map($cell, [
                $fmt($b['created_at']), $fmt($b['updated_at']), $d['lot'], $d['nom'], $d['id_syndic'], $d['email'],
                $b['serial'], $b['stair_a'] ? 'oui' : 'non', $b['stair_b'] ? 'oui' : 'non', $b['stair_c'] ? 'oui' : 'non', $b['parking'] ? 'oui' : 'non',
                $occ[$b['occupant']] ?? $b['occupant'], $b['tenant_name'], $b['tenant_phone'], $b['tenant_email'],
                $owners, $control,
                $central ? (isset($central[$b['serial']]) ? implode(' / ', $central[$b['serial']]) : 'absent') : '',
            ]), ';', '"', '\\');
        }
    }
    fclose($out);
    exit;
}

/** Export de la liste de la centrale, avec le statut de chaque badge. @param int[] $ids liste vide = tout */
function export_central_csv(array $ids): never
{
    $fmt = fn(?string $d) => $d ? (new DateTimeImmutable($d))->format('d/m/Y H:i') : '';
    $cell = function ($v): string {
        $v = (string) $v;
        return ($v !== '' && in_array($v[0], ['=', '+', '-', '@', "\t", "\r"], true)) ? "'" . $v : $v;
    };
    header_remove('Content-Type');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="centrale_badges_' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['nom', 'identifiant', 'code_serie', 'statut', 'detail', 'date_reponse', 'doublon', 'rapprochement', 'coproprietaire', 'identifiant_syndic', 'lots'], ';', '"', '\\');
    $owners = owners_index();
    foreach (central_rows() as $r) {
        $m = $r['match'];
        $o = $m && $m['login'] ? ($owners[$m['login']] ?? null) : null;
        $rapp = !$m ? '' : ($m['status'] === 'valide' ? 'validé' : 'aucun copropriétaire');
        if ($ids && !in_array($r['id'], $ids, true)) {
            continue;
        }
        fputcsv($out, array_map($cell, [
            $r['name'], $r['identifiant'], $r['raw_serial'], CENTRAL_STATUS_LABELS[$r['status']], $r['detail'], $fmt($r['date']), $r['duplicate'] ? 'oui' : '',
            $rapp, $o['name'] ?? '', $m['login'] ?? '', $o ? implode(', ', array_column($o['lots'], 'numero')) : '',
        ]), ';', '"', '\\');
    }
    fclose($out);
    exit;
}
