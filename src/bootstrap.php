<?php
declare(strict_types=1);

const APP_ROOT = __DIR__ . '/..';

date_default_timezone_set('Europe/Paris'); // dates des exports et des emails à l'heure de Paris

function config(?string $key = null)
{
    static $cfg = null;
    if ($cfg === null) {
        $file = getenv('BADGES_CONFIG') ?: APP_ROOT . '/config.php';
        if (!is_file($file)) {
            http_response_code(500);
            exit('Configuration manquante : copiez config.sample.php en config.php.');
        }
        $cfg = require $file;
    }
    return $key === null ? $cfg : ($cfg[$key] ?? null);
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('badges_sid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => (bool) config('secure_cookies'),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

/** 'sqlite' (par défaut, un fichier dans data/) ou 'mysql' (MySQL / MariaDB) */
function db_driver(): string
{
    return config('db_driver') === 'mysql' ? 'mysql' : 'sqlite';
}

/** Tri numérique d'une colonne texte (« 0102 » après « 99 ») selon le moteur */
function sql_int(string $col): string
{
    return db_driver() === 'mysql' ? "CAST($col AS UNSIGNED)" : "CAST($col AS INTEGER)";
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    if (db_driver() === 'mysql') {
        $c = (array) config('mysql');
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'] ?? 'localhost', (int) ($c['port'] ?? 3306), $c['database'] ?? '');
        $pdo = new PDO($dsn, $c['username'] ?? '', $c['password'] ?? '', [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false, // entiers renvoyés en entiers
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ]);
        $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00', sql_mode = CONCAT(@@sql_mode, ',STRICT_TRANS_TABLES')");
        migrate_mysql($pdo);
        return $pdo;
    }
    $path = config('db_path');
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0770, true);
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    migrate($pdo);
    return $pdo;
}

/** MySQL : crée les tables manquantes à partir de bin/schema-mysql.sql (si l'utilisateur a le droit CREATE) */
function migrate_mysql(PDO $pdo): void
{
    $have = array_map('strtolower', $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
    $need = ['declarations', 'badges', 'lots', 'auth_codes', 'known_badges', 'known_reports', 'central_matches', 'settings', 'rate_limits'];
    if (array_diff($need, $have)) {
        $sql = (string) file_get_contents(APP_ROOT . '/bin/schema-mysql.sql');
        $sql = preg_replace('/^\s*--.*$/m', '', $sql);
        foreach (preg_split('/;\s*$/m', $sql) as $stmt) {
            if (trim($stmt) !== '') {
                $pdo->exec($stmt);
            }
        }
    }
    migrate_columns($pdo);
}

/** Colonnes d'une table, quel que soit le moteur */
function table_columns(PDO $pdo, string $table): array
{
    if (db_driver() === 'mysql') {
        return array_column($pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(), 'Field');
    }
    return array_column($pdo->query("PRAGMA table_info($table)")->fetchAll(), 'name');
}

/** Colonnes ajoutées au fil des versions : complétées sur les bases existantes */
function migrate_columns(PDO $pdo): void
{
    $mysql = db_driver() === 'mysql';
    $cols = table_columns($pdo, 'lots');
    foreach (['owner_name' => 241, 'owner_login' => 20, 'owner_lastname' => 120, 'owner_firstname' => 120] as $c => $len) {
        if (!in_array($c, $cols, true)) {
            $pdo->exec("ALTER TABLE lots ADD COLUMN $c " . ($mysql ? "VARCHAR($len) NULL" : 'TEXT'));
            if ($c === 'owner_firstname') { // bases existantes : découper les noms déjà importés
                foreach ($pdo->query('SELECT numero, owner_name FROM lots WHERE owner_name IS NOT NULL')->fetchAll() as $r) {
                    [$last, $first] = split_owner_name($r['owner_name']);
                    $pdo->prepare('UPDATE lots SET owner_lastname = ?, owner_firstname = ? WHERE numero = ?')->execute([$last, $first, $r['numero']]);
                }
            }
        }
    }
    $cols = table_columns($pdo, 'badges');
    foreach (['from_central', 'parking'] as $c) {
        if (!in_array($c, $cols, true)) {
            $pdo->exec("ALTER TABLE badges ADD COLUMN $c " . ($mysql ? 'TINYINT(1)' : 'INTEGER') . ' NOT NULL DEFAULT 0');
        }
    }
}

function migrate(PDO $pdo): void
{
    $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS declarations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot TEXT,
    nom TEXT,
    id_syndic TEXT,
    email TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decl_email ON declarations(email);

CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    declaration_id INTEGER NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
    serial TEXT NOT NULL UNIQUE,
    stair_a INTEGER NOT NULL DEFAULT 0,
    stair_b INTEGER NOT NULL DEFAULT 0,
    stair_c INTEGER NOT NULL DEFAULT 0,
    occupant TEXT NOT NULL CHECK (occupant IN ('coproprietaire','locataire')),
    tenant_name TEXT,
    tenant_phone TEXT,
    tenant_email TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_badges_decl ON badges(declaration_id);

CREATE TABLE IF NOT EXISTS lots (
    numero TEXT PRIMARY KEY,
    libelle TEXT,
    owner_name TEXT,
    owner_login TEXT
);

CREATE TABLE IF NOT EXISTS auth_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS known_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position INTEGER NOT NULL,
    name TEXT,
    identifiant TEXT,
    raw_serial TEXT,
    serial TEXT
);
CREATE INDEX IF NOT EXISTS idx_known_serial ON known_badges(serial);

CREATE TABLE IF NOT EXISTS known_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    declaration_id INTEGER NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
    serial TEXT NOT NULL,
    answer TEXT NOT NULL CHECK (answer IN ('perdu','pas_a_moi')),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_decl ON known_reports(declaration_id);

CREATE TABLE IF NOT EXISTS central_matches (
    k TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('valide','rejete')),
    owner_login TEXT,
    decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    k TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
    k TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    window_start INTEGER NOT NULL
);
SQL);
    migrate_columns($pdo);
}

function now(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Paris')))->format('Y-m-d H:i:s');
}

/* ---------------------------------------------------------------- Validation */

final class ValidationError extends RuntimeException
{
    public function __construct(public array $errors)
    {
        parent::__construct('validation');
    }
}

function normalize_serial(string $s): string
{
    $s = strtoupper(preg_replace('/[\s\-:.]/u', '', $s));
    // « S-1A2B3C4D » (format de la centrale) : le préfixe S n'est pas hexadécimal, on le retire
    return preg_match('/^S[0-9A-F]+$/', $s) ? substr($s, 1) : $s;
}

function serial_error(string $serial): ?string
{
    $min = (int) config('serial_min_length');
    $max = (int) config('serial_max_length');
    if ($serial === '') {
        return 'Le numéro de série est obligatoire.';
    }
    if (!preg_match('/^[0-9A-F]+$/', $serial)) {
        return 'Le numéro ne doit contenir que des chiffres 0–9 et des lettres A–F.';
    }
    $len = strlen($serial);
    if ($len < $min || $len > $max) {
        return "Le numéro doit faire entre $min et $max caractères.";
    }
    return null;
}

function normalize_lot(?string $lot): string
{
    $lot = trim((string) $lot);
    if ($lot === '') {
        return '';
    }
    if (!preg_match('/^\d{1,4}$/', $lot) || (int) $lot === 0) {
        return $lot; // invalide, refusé par la validation
    }
    return (string) (int) $lot; // « 0102 » et « 102 » désignent le même lot
}

function lots_enabled(): bool
{
    return (int) db()->query('SELECT COUNT(*) FROM lots')->fetchColumn() > 0;
}

function normalize_phone(string $p): string
{
    $p = preg_replace('/[\s.\-()]/', '', $p);
    if (str_starts_with($p, '+33')) {
        $p = '0' . substr($p, 3);
    } elseif (str_starts_with($p, '0033')) {
        $p = '0' . substr($p, 4);
    }
    return $p;
}

function clean_text($v, int $max = 120): string
{
    $v = trim(preg_replace('/\s+/u', ' ', (string) $v));
    return mb_substr($v, 0, $max);
}

/**
 * Valide l'identité d'une déclaration. Retourne les valeurs normalisées.
 */
function validate_identity(array $in): array
{
    $errors = [];
    $lot = normalize_lot($in['lot'] ?? '');
    $nom = clean_text($in['nom'] ?? '', 80);
    $syndic = strtoupper(clean_text($in['id_syndic'] ?? '', 20));
    $email = strtolower(clean_text($in['email'] ?? '', 160));

    if ($lot === '' && $nom === '' && $syndic === '') {
        $errors['identity'] = 'Indiquez au moins un numéro de lot, un nom ou un identifiant syndic.';
    }
    if ($lot !== '') {
        if (!preg_match('/^\d{1,4}$/', $lot) || (int) $lot === 0) {
            $errors['lot'] = 'Le numéro de lot comporte 1 à 4 chiffres (ex. 0102).';
        } elseif (config('strict_lots') && lots_enabled()) {
            $st = db()->prepare('SELECT 1 FROM lots WHERE numero = ?');
            $st->execute([$lot]);
            if (!$st->fetchColumn()) {
                $errors['lot'] = "Le lot $lot n'existe pas dans la liste de l'immeuble.";
            }
        }
    }
    if ($nom !== '' && mb_strlen($nom) < 2) {
        $errors['nom'] = 'Le nom est trop court.';
    }
    if ($syndic !== '' && !preg_match(config('syndic_id_pattern'), $syndic)) {
        $errors['id_syndic'] = "L'identifiant syndic est une lettre suivie de 6 chiffres (ex. C543210).";
    }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors['email'] = "L'adresse email n'est pas valide.";
    }
    if ($errors) {
        throw new ValidationError($errors);
    }
    return ['lot' => $lot ?: null, 'nom' => $nom ?: null, 'id_syndic' => $syndic ?: null, 'email' => $email ?: null];
}

/**
 * Valide un badge. $prefix sert à identifier le badge en erreur côté client.
 */
function validate_badge(array $b): array
{
    $errors = [];
    $serial = normalize_serial((string) ($b['serial'] ?? ''));
    if ($e = serial_error($serial)) {
        $errors['serial'] = $e;
    }
    $a = !empty($b['stair_a']);
    $bb = !empty($b['stair_b']);
    $c = !empty($b['stair_c']);
    $parking = !empty($b['parking']);
    if (!$a && !$bb && !$c && !$parking) {
        $errors['stairs'] = 'Cochez au moins un escalier ou la télécommande de parking.';
    }
    $occupant = $b['occupant'] ?? '';
    if (!in_array($occupant, ['coproprietaire', 'locataire'], true)) {
        $errors['occupant'] = 'Indiquez s’il s’agit d’un copropriétaire ou d’un locataire.';
    }
    $tName = $tPhone = $tEmail = null;
    if ($occupant === 'locataire') {
        $tName = clean_text($b['tenant_name'] ?? '', 80) ?: null;
        $tPhone = normalize_phone((string) ($b['tenant_phone'] ?? '')) ?: null;
        $tEmail = strtolower(clean_text($b['tenant_email'] ?? '', 160)) ?: null;
        if ($tPhone !== null && !preg_match('/^0[1-9]\d{8}$/', $tPhone)) {
            $errors['tenant_phone'] = 'Numéro de téléphone français attendu (10 chiffres).';
        }
        if ($tEmail !== null && !filter_var($tEmail, FILTER_VALIDATE_EMAIL)) {
            $errors['tenant_email'] = "L'adresse email du locataire n'est pas valide.";
        }
    }
    if ($errors) {
        throw new ValidationError($errors);
    }
    return [
        'id'           => isset($b['id']) && is_numeric($b['id']) ? (int) $b['id'] : null,
        'serial'       => $serial,
        'stair_a'      => (int) $a,
        'stair_b'      => (int) $bb,
        'stair_c'      => (int) $c,
        'parking'      => (int) $parking,
        'occupant'     => $occupant,
        'tenant_name'  => $tName,
        'tenant_phone' => $tPhone,
        'tenant_email' => $tEmail,
        'from_central' => 0,
    ];
}

/** Le numéro est-il libre ? $ignoreDeclId : badges de cette déclaration ignorés (ils seront réécrits) */
function serial_taken(string $serial, ?int $ignoreDeclId = null, ?int $ignoreBadgeId = null): bool
{
    $sql = 'SELECT 1 FROM badges WHERE serial = ?';
    $args = [$serial];
    if ($ignoreDeclId) {
        $sql .= ' AND declaration_id != ?';
        $args[] = $ignoreDeclId;
    }
    if ($ignoreBadgeId) {
        $sql .= ' AND id != ?';
        $args[] = $ignoreBadgeId;
    }
    $st = db()->prepare($sql);
    $st->execute($args);
    return (bool) $st->fetchColumn();
}

/* ---------------------------------------------------------------- Rate limit */

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

/** true si l'action est autorisée, false si la limite est atteinte */
function rate_limit(string $key, int $max, int $windowSeconds): bool
{
    $pdo = db();
    $t = time();
    $pdo->beginTransaction();
    $st = $pdo->prepare('SELECT hits, window_start FROM rate_limits WHERE k = ?');
    $st->execute([$key]);
    $row = $st->fetch();
    if (!$row || $t - (int) $row['window_start'] >= $windowSeconds) {
        $pdo->prepare('REPLACE INTO rate_limits (k, hits, window_start) VALUES (?, 1, ?)')->execute([$key, $t]);
        $pdo->commit();
        return true;
    }
    if ((int) $row['hits'] >= $max) {
        $pdo->commit();
        return false;
    }
    $pdo->prepare('UPDATE rate_limits SET hits = hits + 1 WHERE k = ?')->execute([$key]);
    $pdo->commit();
    return true;
}

/* ---------------------------------------------------------------- Data access */

function load_declarations(string $where = '1=1', array $args = []): array
{
    $st = db()->prepare("SELECT * FROM declarations WHERE $where ORDER BY created_at DESC, id DESC");
    $st->execute($args);
    $decls = $st->fetchAll();
    if (!$decls) {
        return [];
    }
    $ids = array_column($decls, 'id');
    $in = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare("SELECT * FROM badges WHERE declaration_id IN ($in) ORDER BY id");
    $st->execute($ids);
    $byDecl = [];
    foreach ($st->fetchAll() as $b) {
        $b['id'] = (int) $b['id'];
        $b['declaration_id'] = (int) $b['declaration_id'];
        foreach (['stair_a', 'stair_b', 'stair_c', 'parking', 'from_central'] as $k) {
            $b[$k] = (bool) $b[$k];
        }
        $byDecl[$b['declaration_id']][] = $b;
    }
    $st = db()->prepare("SELECT declaration_id, serial, answer, created_at FROM known_reports WHERE declaration_id IN ($in) ORDER BY id");
    $st->execute($ids);
    $reports = [];
    foreach ($st->fetchAll() as $r) {
        $reports[(int) $r['declaration_id']][] = ['serial' => $r['serial'], 'answer' => $r['answer'], 'created_at' => $r['created_at']];
    }
    foreach ($decls as &$d) {
        $d['id'] = (int) $d['id'];
        $d['badges'] = $byDecl[$d['id']] ?? [];
        $d['reports'] = $reports[$d['id']] ?? [];
    }
    return $decls;
}

/**
 * Valide identité ET badges ensemble, pour renvoyer toutes les erreurs d'un coup.
 */
function validate_all(array $in, ?int $declId, ?array $tokenMap = null, bool $admin = false): array
{
    $errors = [];
    $identity = null;
    $badges = null;
    try {
        $identity = validate_identity($in);
    } catch (ValidationError $e) {
        $errors = $e->errors;
    }
    try {
        $badges = validate_badges((array) ($in['badges'] ?? []), $declId, $tokenMap, $admin, !empty($in['central_answers']));
    } catch (ValidationError $e) {
        $errors += $e->errors;
    }
    if ($errors) {
        throw new ValidationError($errors);
    }
    $reports = null;
    if ($tokenMap !== null) { // réponses du résident aux badges proposés (« plus en possession », « pas à moi »)
        $reports = [];
        $declared = array_flip(array_column($badges, 'serial'));
        foreach ((array) ($in['central_answers'] ?? []) as $a) {
            $serial = $tokenMap[(string) ($a['token'] ?? '')] ?? null;
            $answer = $a['answer'] ?? '';
            if ($serial && in_array($answer, ['perdu', 'pas_a_moi'], true) && !isset($declared[$serial])) {
                $reports[$serial] = ['serial' => $serial, 'answer' => $answer];
            }
        }
        $reports = array_values($reports);
        if (!$badges && !$reports) {
            throw new ValidationError(['badges' => 'Ajoutez au moins un badge.']);
        }
    }
    return [$identity, $badges, $reports];
}

/**
 * @param array|null $tokenMap jeton => numéro, pour les badges de l'ancienne centrale proposés au résident (null : administrateur)
 */
function validate_badges(array $rawBadges, ?int $declId, ?array $tokenMap = null, bool $admin = false, bool $allowEmpty = false): array
{
    if (!$rawBadges && $allowEmpty) {
        return []; // seulement des réponses aux badges proposés (ex. badge perdu)
    }
    if (!$rawBadges) {
        throw new ValidationError(['badges' => 'Ajoutez au moins un badge.']);
    }
    if (count($rawBadges) > 200) {
        throw new ValidationError(['badges' => 'Trop de badges dans une seule déclaration.']);
    }
    $badges = [];
    $badgeErrors = [];
    $seen = [];
    foreach (array_values($rawBadges) as $i => $raw) {
        $raw = is_array($raw) ? $raw : [];
        $fromCentral = 0;
        if (!$admin && !empty($raw['known_token'])) {
            $serial = $tokenMap[(string) $raw['known_token']] ?? null;
            if (!$serial) {
                $badgeErrors[$i] = ['serial' => 'Ce badge de l’ancienne centrale n’a pas pu être vérifié. Rechargez la page.'];
                continue;
            }
            $raw['serial'] = $serial;
            $fromCentral = 1;
        } elseif ($admin) {
            $fromCentral = empty($raw['from_central']) ? 0 : 1;
        }
        try {
            $b = validate_badge($raw);
            $b['from_central'] = $fromCentral;
            if (isset($seen[$b['serial']])) {
                $badgeErrors[$i] = ['serial' => 'Ce numéro figure deux fois dans votre déclaration.'];
                continue;
            }
            $seen[$b['serial']] = true;
            if (serial_taken($b['serial'], $declId)) {
                $badgeErrors[$i] = ['serial' => 'Ce badge est déjà déclaré.'];
                continue;
            }
            $badges[] = $b;
        } catch (ValidationError $e) {
            $badgeErrors[$i] = $e->errors;
        }
    }
    if ($badgeErrors) {
        throw new ValidationError(['badges_detail' => (object) $badgeErrors, 'badges' => 'Un ou plusieurs badges sont à corriger.']);
    }
    return $badges;
}

/**
 * Crée ou met à jour une déclaration et remplace l'ensemble de ses badges.
 * $badges doit provenir de validate_badges().
 */
function save_declaration(?int $declId, array $identity, array $badges, ?array $reports = null): int
{
    $pdo = db();
    $t = now();
    $pdo->beginTransaction();
    try {
        if ($declId) {
            $pdo->prepare('UPDATE declarations SET lot=?, nom=?, id_syndic=?, email=?, updated_at=? WHERE id=?')
                ->execute([$identity['lot'], $identity['nom'], $identity['id_syndic'], $identity['email'], $t, $declId]);
            $existing = $pdo->prepare('SELECT id, serial, created_at FROM badges WHERE declaration_id = ?');
            $existing->execute([$declId]);
            $old = [];
            foreach ($existing->fetchAll() as $r) {
                $old[(int) $r['id']] = $r;
            }
            // Supprimer d'abord ceux qui disparaissent (libère leurs numéros)
            $keepIds = array_filter(array_map(fn($b) => $b['id'], $badges));
            foreach (array_keys($old) as $oid) {
                if (!in_array($oid, $keepIds, true)) {
                    $pdo->prepare('DELETE FROM badges WHERE id = ?')->execute([$oid]);
                }
            }
            // Mettre de côté les numéros des badges conservés pour éviter les conflits d'unicité lors d'échanges
            foreach ($badges as $b) {
                if ($b['id'] && isset($old[$b['id']])) {
                    $pdo->prepare("UPDATE badges SET serial = " . (db_driver() === 'mysql' ? "CONCAT('~', id)" : "'~' || id") . " WHERE id = ?")->execute([$b['id']]);
                }
            }
        } else {
            $pdo->prepare('INSERT INTO declarations (lot, nom, id_syndic, email, created_at, updated_at) VALUES (?,?,?,?,?,?)')
                ->execute([$identity['lot'], $identity['nom'], $identity['id_syndic'], $identity['email'], $t, $t]);
            $declId = (int) $pdo->lastInsertId();
            $old = [];
        }
        foreach ($badges as $b) {
            $vals = [$b['serial'], $b['stair_a'], $b['stair_b'], $b['stair_c'], $b['occupant'], $b['tenant_name'], $b['tenant_phone'], $b['tenant_email'], (int) ($b['from_central'] ?? 0), (int) ($b['parking'] ?? 0)];
            if ($b['id'] && isset($old[$b['id']])) {
                $pdo->prepare('UPDATE badges SET serial=?, stair_a=?, stair_b=?, stair_c=?, occupant=?, tenant_name=?, tenant_phone=?, tenant_email=?, from_central=?, parking=?, updated_at=? WHERE id=?')
                    ->execute([...$vals, $t, $b['id']]);
            } else {
                $pdo->prepare('INSERT INTO badges (serial, stair_a, stair_b, stair_c, occupant, tenant_name, tenant_phone, tenant_email, from_central, parking, declaration_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    ->execute([...$vals, $declId, $t, $t]);
            }
        }
        if ($reports !== null) {
            $pdo->prepare('DELETE FROM known_reports WHERE declaration_id = ?')->execute([$declId]);
            $ins = $pdo->prepare('INSERT INTO known_reports (declaration_id, serial, answer, created_at) VALUES (?,?,?,?)');
            foreach ($reports as $r) {
                $ins->execute([$declId, $r['serial'], $r['answer'], $t]);
            }
        }
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        if ($e->getCode() === '23000' || str_contains($e->getMessage(), 'UNIQUE') || str_contains($e->getMessage(), 'Duplicate')) {
            throw new ValidationError(['badges' => 'Un des badges vient d’être déclaré par quelqu’un d’autre. Vérifiez les numéros.']);
        }
        throw $e;
    }
    return $declId;
}

/* ---------------------------------------------------------------- Liste des lots */

/**
 * Lit la liste des lots depuis :
 *  - l'export JSON du syndic : {"data":[{"computedName":…, "login":…, "lots":[{"name":"0102 (APPARTEMENT)"}…]}…]}
 *  - ou un CSV : numéro ; libellé facultatif
 * Retourne [numero => ['libelle' =>…, 'owner_name' =>…, 'owner_login' =>…]].
 * Du JSON, seuls le numéro, le type de lot, le nom et l'identifiant du copropriétaire sont conservés.
 */
function parse_lots(string $content): array
{
    $content = trim(preg_replace('/^\xEF\xBB\xBF/', '', $content));
    if (!mb_check_encoding($content, 'UTF-8')) {
        $content = mb_convert_encoding($content, 'UTF-8', 'Windows-1252');
    }
    $lots = [];
    if ($content !== '' && ($content[0] === '{' || $content[0] === '[')) {
        $json = json_decode($content, true);
        if (!is_array($json)) {
            throw new ValidationError(['csv' => 'Le fichier JSON est illisible.']);
        }
        $rows = $json['data'] ?? $json;
        foreach ((array) $rows as $owner) {
            if (!is_array($owner)) {
                continue;
            }
            [$last, $first] = split_owner_name(clean_text($owner['computedName'] ?? '', 120));
            $login = strtoupper(clean_text($owner['login'] ?? '', 20)) ?: null;
            foreach ((array) ($owner['lots'] ?? []) as $lot) {
                if (!preg_match('/^\s*(\d{1,4})\s*(?:\((.*)\))?/u', (string) ($lot['name'] ?? ''), $m) || (int) $m[1] === 0) {
                    continue;
                }
                $type = trim($m[2] ?? '');
                $type = $type === '' ? null : mb_strtoupper(mb_substr($type, 0, 1)) . mb_strtolower(mb_substr($type, 1)); // « Local commercial »
                $lots[(string) (int) $m[1]] = lot_record($type, $last, $first, $login);
            }
        }
        return $lots;
    }
    // CSV : en-tête reconnu (numero ; type ; nom ; prenom ; identifiant_syndic), sinon numéro ; libellé
    $lines = preg_split('/\r\n|\r|\n/', $content);
    $first = '';
    foreach ($lines as $l) {
        if (trim($l) !== '') {
            $first = $l;
            break;
        }
    }
    $sep = str_contains($first, "\t") ? "\t" : (substr_count($first, ';') >= substr_count($first, ',') ? ';' : ',');
    $cols = ['numero' => 0, 'libelle' => 1, 'nom' => null, 'prenom' => null, 'login' => null];
    $norm = fn($h) => strtolower(strtr(trim($h), ['é' => 'e', 'É' => 'e', 'è' => 'e', 'ô' => 'o']));
    foreach (str_getcsv($first, $sep, '"', '\\') as $i => $h) {
        $h = $norm($h);
        if (str_contains($h, 'prenom')) {
            $cols['prenom'] = $i;
        } elseif (str_contains($h, 'identifiant') || str_contains($h, 'login')) {
            $cols['login'] = $i;
        } elseif (str_contains($h, 'numero') || $h === 'lot') {
            $cols['numero'] = $i;
        } elseif (str_contains($h, 'type') || str_contains($h, 'libelle')) {
            $cols['libelle'] = $i;
        } elseif ($h === 'nom' || str_contains($h, 'coproprietaire')) {
            $cols['nom'] = $i;
        }
    }
    foreach ($lines as $line) {
        if (trim($line) === '') {
            continue;
        }
        $c = str_getcsv($line, $sep, '"', '\\');
        $num = trim((string) ($c[$cols['numero']] ?? ''));
        if (!preg_match('/^\d{1,4}$/', $num) || (int) $num === 0) {
            continue; // en-tête ou ligne invalide
        }
        $get = fn($k, $max = 120) => $cols[$k] === null ? '' : clean_text($c[$cols[$k]] ?? '', $max);
        $login = strtoupper($get('login', 20));
        $lots[(string) (int) $num] = lot_record($get('libelle') ?: null, $get('nom'), $get('prenom'), preg_match(config('syndic_id_pattern'), $login) ? $login : null);
    }
    return $lots;
}

/** « ALLARD Jean Luc » → [ALLARD, Jean Luc] : le nom est en majuscules, le prénom suit */
function split_owner_name(?string $full): array
{
    $words = preg_split('/\s+/u', trim((string) $full), -1, PREG_SPLIT_NO_EMPTY);
    $i = count($words);
    while ($i > 0 && preg_match('/\p{Ll}/u', $words[$i - 1])) {
        $i--;
    }
    return [implode(' ', array_slice($words, 0, $i)), implode(' ', array_slice($words, $i))];
}

function lot_record(?string $libelle, ?string $last, ?string $first, ?string $login): array
{
    $last = trim((string) $last);
    $first = trim((string) $first);
    $full = trim($last . ' ' . $first);
    return ['libelle' => $libelle ?: null, 'owner_lastname' => $last ?: null, 'owner_firstname' => $first ?: null, 'owner_name' => $full ?: null, 'owner_login' => $login ?: null];
}

/** Liste des lots pour l'administration (numéro sur 4 chiffres) */
function lots_rows(): array
{
    $rows = [];
    foreach (db()->query('SELECT numero, libelle, owner_lastname, owner_firstname, owner_login FROM lots ORDER BY ' . sql_int('numero')) as $r) {
        $rows[] = ['numero' => str_pad($r['numero'], 4, '0', STR_PAD_LEFT), 'libelle' => $r['libelle'], 'nom' => $r['owner_lastname'], 'prenom' => $r['owner_firstname'], 'login' => $r['owner_login']];
    }
    return $rows;
}

/** Remplace toute la liste des lots */
function replace_lots(array $lots): int
{
    $pdo = db();
    $pdo->beginTransaction();
    $pdo->exec('DELETE FROM lots');
    $ins = $pdo->prepare('INSERT INTO lots (numero, libelle, owner_lastname, owner_firstname, owner_name, owner_login) VALUES (?,?,?,?,?,?)');
    $owners = [];
    foreach ($lots as $n => $l) {
        $ins->execute([(string) $n, $l['libelle'], $l['owner_lastname'], $l['owner_firstname'], $l['owner_name'], $l['owner_login']]);
        if ($l['owner_login']) {
            $owners[$l['owner_login']] = true;
        }
    }
    $pdo->commit();
    return count($owners);
}

/** Index des copropriétaires connus du syndic (vide si la liste importée n'en contient pas) */
function syndic_index(): array
{
    $idx = ['byLot' => [], 'byLogin' => []];
    foreach (db()->query('SELECT numero, owner_name, owner_login FROM lots WHERE owner_login IS NOT NULL') as $r) {
        $o = ['name' => $r['owner_name'], 'login' => $r['owner_login']];
        $idx['byLot'][$r['numero']] = $o;
        $idx['byLogin'][$r['owner_login']] ??= $o + ['lots' => []];
        $idx['byLogin'][$r['owner_login']]['lots'][] = $r['numero'];
    }
    return $idx;
}

function name_tokens(?string $s): array
{
    $s = (string) $s;
    $t = class_exists('Transliterator') ? \Transliterator::create('Any-Latin; Latin-ASCII')?->transliterate($s) : null;
    $s = strtoupper($t ?? iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) ?: $s);
    return array_values(array_filter(preg_split('/[^A-Z]+/', $s), fn($w) => strlen($w) >= 3));
}

/**
 * Compare l'identité déclarée à la liste du syndic. Rien de bloquant : sert à l'administrateur.
 * @return array{owners: array, issues: string[]}|null  null si aucune liste de copropriétaires n'est chargée
 */
function syndic_check(array $decl, array $idx): ?array
{
    if (!$idx['byLogin']) {
        return null;
    }
    $issues = [];
    $owners = [];
    if ($decl['lot']) {
        if (isset($idx['byLot'][$decl['lot']])) {
            $owners[] = $idx['byLot'][$decl['lot']];
        } else {
            $issues[] = 'Lot inconnu du syndic';
        }
    }
    if ($decl['id_syndic']) {
        $known = $idx['byLogin'][$decl['id_syndic']] ?? null;
        if (!$known) {
            $issues[] = 'Identifiant syndic inconnu';
        } elseif ($decl['lot'] && $owners && $owners[0]['login'] !== $decl['id_syndic']) {
            $issues[] = 'Identifiant syndic d’un autre copropriétaire que le lot';
            $owners[] = ['name' => $known['name'], 'login' => $known['login']];
        } elseif (!$owners) {
            $owners[] = ['name' => $known['name'], 'login' => $known['login']];
        }
    }
    if ($decl['nom'] && $owners) {
        $declared = name_tokens($decl['nom']);
        $match = false;
        foreach ($owners as $o) {
            if (array_intersect($declared, name_tokens($o['name']))) {
                $match = true;
            }
        }
        if (!$match) {
            $issues[] = 'Nom différent du copropriétaire (locataire ?)';
        }
    }
    return ['owners' => $owners, 'issues' => $issues];
}

/* ---------------------------------------------------------------- Liste de la centrale actuelle */

/** Clé secrète de l'application (jetons des badges proposés) : config ou fichier généré dans data/ */
function app_secret(): string
{
    static $secret = null;
    if ($secret !== null) {
        return $secret;
    }
    $secret = (string) config('app_secret');
    if ($secret === '') {
        $file = dirname(config('db_path')) . '/secret.key';
        if (!is_file($file)) {
            file_put_contents($file, bin2hex(random_bytes(32)), LOCK_EX);
            @chmod($file, 0600);
        }
        $secret = trim((string) file_get_contents($file));
    }
    return $secret;
}

/** Jeton opaque d'un badge de la centrale : le numéro complet ne quitte jamais le serveur */
function central_token(string $serial): string
{
    return substr(hash_hmac('sha256', 'central|' . $serial, app_secret()), 0, 20);
}

function central_hint(string $serial): string
{
    return substr($serial, -4);
}

function central_loaded(): bool
{
    return (bool) db()->query("SELECT 1 FROM known_badges WHERE serial != '' LIMIT 1")->fetchColumn();
}

/** Mots trop génériques pour rapprocher un nom (gardien, syndic, installateur…) */
const CENTRAL_STOP_WORDS = ['GARDIEN', 'SYNDIC', 'SINDIC', 'MISE', 'SERVICE', 'AXE', 'VAN', 'DES', 'LES', 'MME', 'MLLE', 'MONSIEUR', 'MADAME', 'SCI', 'SARL', 'SAS', 'EPOUX', 'FAMILLE', 'PLUS'];

function central_name_tokens(?string $name): array
{
    return array_values(array_diff(name_tokens($name), CENTRAL_STOP_WORDS));
}

/**
 * Lit la liste exportée de la centrale (texte tabulé, ou CSV ; / ,).
 * Colonnes reconnues par leur en-tête (Nom, Identifiant, Code Série), sinon dans cet ordre.
 * @return list<array{name:string, identifiant:string, raw_serial:string, serial:string}>
 */
function parse_central(string $content): array
{
    $content = preg_replace('/^\xEF\xBB\xBF/', '', $content);
    if (!mb_check_encoding($content, 'UTF-8')) {
        $content = mb_convert_encoding($content, 'UTF-8', 'Windows-1252');
    }
    $lines = preg_split('/\r\n|\r|\n/', $content);
    $first = '';
    foreach ($lines as $l) {
        if (trim($l) !== '') {
            $first = $l;
            break;
        }
    }
    $sep = str_contains($first, "\t") ? "\t" : (substr_count($first, ';') >= substr_count($first, ',') ? ';' : ',');
    $cols = ['name' => 0, 'identifiant' => 1, 'serial' => 2];
    $header = array_map(fn($c) => mb_strtolower(trim($c)), str_getcsv($first, $sep, '"', '\\'));
    $hasHeader = false;
    foreach ($header as $i => $h) {
        if ($h === 'nom' || str_starts_with($h, 'nom ')) {
            $cols['name'] = $i;
            $hasHeader = true;
        } elseif (str_contains($h, 'identifiant')) {
            $cols['identifiant'] = $i;
        } elseif (str_contains($h, 'code') || str_contains($h, 'rie')) {
            $cols['serial'] = $i;
        }
    }
    $rows = [];
    $skippedHeader = !$hasHeader;
    foreach ($lines as $line) {
        if (trim($line) === '') {
            continue;
        }
        if (!$skippedHeader) {
            $skippedHeader = true;
            continue;
        }
        $c = str_getcsv($line, $sep, '"', '\\');
        $name = clean_text($c[$cols['name']] ?? '', 120);
        $ident = clean_text($c[$cols['identifiant']] ?? '', 40);
        $raw = clean_text($c[$cols['serial']] ?? '', 40);
        if ($name === '' && $ident === '' && $raw === '') {
            continue;
        }
        $serial = normalize_serial($raw);
        $rows[] = ['name' => $name, 'identifiant' => $ident, 'raw_serial' => $raw, 'serial' => serial_error($serial) === null ? $serial : ''];
    }
    return $rows;
}

/** Mots du nom à rapprocher : nom saisi + copropriétaire du lot + copropriétaire de l'identifiant syndic */
function identity_tokens(array $in): array
{
    $tokens = central_name_tokens(clean_text($in['nom'] ?? '', 80));
    $lot = normalize_lot($in['lot'] ?? '');
    if ($lot !== '' && preg_match('/^\d{1,4}$/', $lot)) {
        $st = db()->prepare('SELECT owner_name FROM lots WHERE numero = ?');
        $st->execute([$lot]);
        $tokens = array_merge($tokens, central_name_tokens($st->fetchColumn() ?: ''));
    }
    $login = strtoupper(clean_text($in['id_syndic'] ?? '', 20));
    if ($login !== '' && preg_match(config('syndic_id_pattern'), $login)) {
        $st = db()->prepare('SELECT owner_name FROM lots WHERE owner_login = ? LIMIT 1');
        $st->execute([$login]);
        $tokens = array_merge($tokens, central_name_tokens($st->fetchColumn() ?: ''));
    }
    return array_values(array_unique($tokens));
}

/**
 * Badges de la centrale qui semblent appartenir au résident (hors badges déjà déclarés par une autre déclaration).
 * @return list<array{serial:string, token:string, hint:string}>
 */
function central_suggestions(array $in, ?int $declId = null): array
{
    // Mots du nom tapé par le résident, et mots des noms des copropriétaires désignés par le lot / l'identifiant
    $typed = central_name_tokens(clean_text($in['nom'] ?? '', 80));
    $all = identity_tokens($in);
    $logins = identity_logins($in);
    if (!$all && !$logins) {
        return [];
    }
    $decisions = central_decisions();
    $st = db()->prepare('SELECT DISTINCT serial FROM badges WHERE declaration_id != ?');
    $st->execute([$declId ?? 0]);
    $taken = array_flip($st->fetchAll(PDO::FETCH_COLUMN));
    $out = [];
    foreach (db()->query("SELECT name, serial FROM known_badges WHERE serial != '' ORDER BY position") as $r) {
        if (isset($out[$r['serial']]) || isset($taken[$r['serial']])) {
            continue;
        }
        $tokens = central_name_tokens($r['name']);
        $d = $decisions[central_key($r['name'], $r['serial'])] ?? null;
        if ($d) {
            // Rapprochement décidé par le conseil syndical : il prime sur la ressemblance des noms des copropriétaires
            $match = ($d['status'] === 'valide' && in_array($d['owner_login'], $logins, true)) || array_intersect($tokens, $typed);
        } else {
            $match = (bool) array_intersect($tokens, $all);
        }
        if ($match) {
            $out[$r['serial']] = ['serial' => $r['serial'], 'token' => central_token($r['serial']), 'hint' => central_hint($r['serial'])];
        }
    }
    return array_values($out);
}

/** Identifiants syndic désignés par le lot et / ou l'identifiant saisis */
function identity_logins(array $in): array
{
    $logins = [];
    $lot = normalize_lot($in['lot'] ?? '');
    if ($lot !== '' && preg_match('/^\d{1,4}$/', $lot)) {
        $st = db()->prepare('SELECT owner_login FROM lots WHERE numero = ? AND owner_login IS NOT NULL');
        $st->execute([$lot]);
        $logins[] = $st->fetchColumn();
    }
    $login = strtoupper(clean_text($in['id_syndic'] ?? '', 20));
    if ($login !== '') {
        $st = db()->prepare('SELECT 1 FROM lots WHERE owner_login = ? LIMIT 1');
        $st->execute([$login]);
        if ($st->fetchColumn()) {
            $logins[] = $login;
        }
    }
    return array_values(array_filter(array_unique($logins)));
}

/* ---------------------------------------------------------------- Rapprochement centrale <-> syndic */

/** Clé d'une ligne de la centrale, stable d'un import à l'autre (nom + code série) */
function central_key(?string $name, ?string $serial): string
{
    return mb_strtoupper(clean_text($name, 120)) . '|' . (string) $serial;
}

/** Décisions du conseil syndical : clé => [status, owner_login, decided_at] */
function central_decisions(): array
{
    $out = [];
    foreach (db()->query('SELECT k, status, owner_login, decided_at FROM central_matches') as $r) {
        $out[$r['k']] = $r;
    }
    return $out;
}

/** Copropriétaires de la liste du syndic : identifiant => [login, name, lots, tokens] */
function owners_index(): array
{
    $owners = [];
    foreach (db()->query('SELECT numero, libelle, owner_name, owner_login FROM lots WHERE owner_login IS NOT NULL ORDER BY ' . sql_int('numero')) as $r) {
        $o = &$owners[$r['owner_login']];
        $o ??= ['login' => $r['owner_login'], 'name' => $r['owner_name'], 'lots' => [], 'tokens' => central_name_tokens($r['owner_name'])];
        $o['lots'][] = ['numero' => str_pad($r['numero'], 4, '0', STR_PAD_LEFT), 'libelle' => $r['libelle']];
        unset($o);
    }
    uasort($owners, fn($a, $b) => strcmp($a['name'], $b['name']));
    return $owners;
}

function tokens_similar(string $a, string $b): bool
{
    return $a === $b || (strlen($a) >= 5 && strlen($b) >= 5 && levenshtein($a, $b) <= 1);
}

/**
 * Copropriétaires dont le nom ressemble au nom de la centrale, du plus probable au moins probable.
 * score = part des mots du nom de la centrale retrouvés chez le copropriétaire.
 */
function match_candidates(array $tokens, array $owners): array
{
    if (!$tokens) {
        return [];
    }
    $out = [];
    foreach ($owners as $o) {
        $hit = 0;
        $long = false;
        foreach ($tokens as $t) {
            foreach ($o['tokens'] as $u) {
                if (tokens_similar($t, $u)) {
                    $hit += $t === $u ? 1 : 0.75; // orthographe approchée (REYNIER / REGNIER) : un peu moins sûr
                    $long = $long || strlen($t) >= 5;
                    break;
                }
            }
        }
        if ($hit) {
            $out[] = ['login' => $o['login'], 'score' => $hit / count($tokens), 'cover' => $o['tokens'] ? $hit / count($o['tokens']) : 0, 'long' => $long];
        }
    }
    usort($out, fn($a, $b) => [$b['score'], $b['cover']] <=> [$a['score'], $a['cover']]);
    return $out;
}

/** sure : tous les mots retrouvés chez un seul copropriétaire ; probable : nom partiel distinctif ; faible : mot court seulement */
function match_level(array $cands): string
{
    if (!$cands) {
        return 'aucune';
    }
    $best = $cands[0];
    $ties = array_filter($cands, fn($c) => $c['score'] === $best['score']);
    if ($best['score'] >= 1 && count($ties) === 1) {
        return 'sure';
    }
    return ($best['score'] >= 0.5 || $best['long']) ? 'probable' : 'faible';
}

/** Lignes nommées de la centrale avec propositions et décisions (les lignes simplement numérotées sont ignorées) */
function matching_rows(): array
{
    $owners = owners_index();
    $decisions = central_decisions();
    $pub = fn($login) => isset($owners[$login]) ? ['login' => $login, 'name' => $owners[$login]['name'], 'lots' => $owners[$login]['lots']] : ['login' => $login, 'name' => null, 'lots' => []];
    $rows = [];
    foreach (db()->query('SELECT id, name, identifiant, raw_serial, serial FROM known_badges ORDER BY position') as $r) {
        if ($r['name'] === null || $r['name'] === '' || preg_match('/^\d+$/', $r['name'])) {
            continue;
        }
        $cands = match_candidates(central_name_tokens($r['name']), $owners);
        $key = central_key($r['name'], $r['serial']);
        $d = $decisions[$key] ?? null;
        $rows[] = [
            'id' => (int) $r['id'],
            'key' => $key,
            'name' => $r['name'],
            'identifiant' => $r['identifiant'],
            'raw_serial' => $r['raw_serial'],
            'level' => match_level($cands),
            'candidates' => array_map(fn($c) => $pub($c['login']) + ['score' => round($c['score'], 2)], array_slice($cands, 0, 5)),
            'decision' => $d ? ['status' => $d['status'], 'decided_at' => $d['decided_at']] + ($d['owner_login'] ? ['owner' => $pub($d['owner_login'])] : []) : null,
        ];
    }
    return $rows;
}

function save_match_decision(string $key, string $action, ?string $login): void
{
    if ($action === 'reset') {
        db()->prepare('DELETE FROM central_matches WHERE k = ?')->execute([$key]);
        return;
    }
    if ($action === 'valider') {
        $st = db()->prepare('SELECT 1 FROM lots WHERE owner_login = ? LIMIT 1');
        $st->execute([$login]);
        if (!$login || !$st->fetchColumn()) {
            throw new ValidationError(['owner' => 'Choisissez un copropriétaire de la liste du syndic.']);
        }
    }
    db()->prepare('REPLACE INTO central_matches (k, status, owner_login, decided_at) VALUES (?,?,?,?)')
        ->execute([$key, $action === 'valider' ? 'valide' : 'rejete', $action === 'valider' ? $login : null, now()]);
}

/** Jetons acceptés pour une déclaration : propositions actuelles + badges et réponses déjà enregistrés */
function central_token_map(array $in, ?int $declId): array
{
    $map = [];
    foreach (central_suggestions($in, $declId) as $s) {
        $map[$s['token']] = $s['serial'];
    }
    if ($declId) {
        $st = db()->prepare('SELECT serial FROM badges WHERE declaration_id = ? AND from_central = 1 UNION SELECT serial FROM known_reports WHERE declaration_id = ?');
        $st->execute([$declId, $declId]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $serial) {
            $map[central_token($serial)] = $serial;
        }
    }
    return $map;
}

/** Version d'une déclaration renvoyée au résident : numéros de la centrale masqués */
function public_declaration(array $d): array
{
    foreach ($d['badges'] as &$b) {
        if (!empty($b['from_central'])) {
            $b['known_token'] = central_token($b['serial']);
            $b['hint'] = central_hint($b['serial']);
            $b['serial'] = '';
        }
        unset($b['from_central']);
    }
    unset($b);
    $d['central_answers'] = array_map(fn($r) => ['token' => central_token($r['serial']), 'hint' => central_hint($r['serial']), 'answer' => $r['answer']], $d['reports'] ?? []);
    unset($d['reports']);
    return $d;
}

/** Noms de la centrale par numéro (pour l'administration) */
function central_names_by_serial(): array
{
    $map = [];
    foreach (db()->query("SELECT serial, name FROM known_badges WHERE serial != '' ORDER BY position") as $r) {
        $map[$r['serial']][] = $r['name'];
    }
    return $map;
}

const CENTRAL_STATUS_LABELS = [
    'declare'     => 'Déclaré',
    'perdu'       => 'Plus en possession',
    'pas_a_moi'   => 'Refusé par le résident',
    'non_declare' => 'Non déclaré',
    'sans_numero' => 'Sans numéro de série',
];

/** Liste de la centrale avec, pour chaque badge, son statut au regard des déclarations */
function central_rows(): array
{
    $who = fn($r) => trim(implode(' · ', array_filter([$r['lot'] ? 'Lot ' . str_pad($r['lot'], 4, '0', STR_PAD_LEFT) : null, $r['nom'], $r['id_syndic']])));
    $declared = [];
    foreach (db()->query('SELECT b.serial, b.created_at, d.lot, d.nom, d.id_syndic FROM badges b JOIN declarations d ON d.id = b.declaration_id') as $r) {
        $declared[$r['serial']] = ['who' => $who($r), 'date' => $r['created_at']];
    }
    $reports = [];
    foreach (db()->query('SELECT r.serial, r.answer, r.created_at, d.lot, d.nom, d.id_syndic FROM known_reports r JOIN declarations d ON d.id = r.declaration_id ORDER BY r.id') as $r) {
        $reports[$r['serial']][$r['answer']][] = ['who' => $who($r), 'date' => $r['created_at']];
    }
    $rows = db()->query('SELECT id, name, identifiant, raw_serial, serial FROM known_badges ORDER BY position')->fetchAll();
    $count = array_count_values(array_filter(array_column($rows, 'serial')));
    $decisions = central_decisions();
    $ownerNames = [];
    foreach (db()->query('SELECT DISTINCT owner_login, owner_name FROM lots WHERE owner_login IS NOT NULL') as $o) {
        $ownerNames[$o['owner_login']] = $o['owner_name'];
    }
    foreach ($rows as &$r) {
        $r['id'] = (int) $r['id'];
        $d = $decisions[central_key($r['name'], $r['serial'])] ?? null;
        $r['match'] = $d ? ['status' => $d['status'], 'login' => $d['owner_login'], 'name' => $d['owner_login'] ? ($ownerNames[$d['owner_login']] ?? null) : null] : null;
        $s = $r['serial'];
        $r['duplicate'] = $s !== '' && $count[$s] > 1;
        $r['detail'] = '';
        $r['date'] = null;
        if ($s === '') {
            $r['status'] = 'sans_numero';
        } elseif (isset($declared[$s])) {
            $r['status'] = 'declare';
            $r['detail'] = $declared[$s]['who'];
            $r['date'] = $declared[$s]['date'];
        } elseif (isset($reports[$s]['perdu'])) {
            $r['status'] = 'perdu';
            $r['detail'] = implode(' / ', array_column($reports[$s]['perdu'], 'who'));
            $r['date'] = end($reports[$s]['perdu'])['date'];
        } elseif (isset($reports[$s]['pas_a_moi'])) {
            $r['status'] = 'pas_a_moi';
            $r['detail'] = implode(' / ', array_column($reports[$s]['pas_a_moi'], 'who'));
            $r['date'] = end($reports[$s]['pas_a_moi'])['date'];
        } else {
            $r['status'] = 'non_declare';
        }
    }
    return $rows;
}

/** Données de départ des pages (servies aussi par l'action « session » de l'API) */
function session_payload(): array
{
    return [
        'ok' => true,
        'csrf' => $_SESSION['csrf'],
        'residence' => config('residence_name'),
        'contact' => config('contact_email'),
        'lots' => db()->query('SELECT numero, libelle FROM lots ORDER BY ' . sql_int('numero'))->fetchAll(),
        'strict_lots' => (bool) config('strict_lots'),
        'ocr' => trim((string) config('anthropic_api_key')) !== '' ? 'server' : 'local',
        'serial_min' => (int) config('serial_min_length'),
        'serial_max' => (int) config('serial_max_length'),
        'resident_email' => $_SESSION['resident_email'] ?? null,
        'admin' => !empty($_SESSION['admin']),
        'central' => central_loaded(),
    ];
}

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}
