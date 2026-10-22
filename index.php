<?php
/**
 * Point d'entrée de secours, à la racine du projet.
 *
 * L'application s'exécute dans le dossier public/. Si la racine du site (ou du sous-domaine)
 * pointe sur ce dossier-ci au lieu de public/, et que la réécriture d'URL du .htaccess n'est
 * pas active, ce fichier renvoie le visiteur vers public/, en gardant le chemin demandé
 * (ex. /admin → public/admin/) et les paramètres d'URL.
 *
 * Fonctionne aussi quand l'application est installée dans un sous-dossier (ex. /badges/).
 */
declare(strict_types=1);

if (!is_dir(__DIR__ . '/public')) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Installation incomplète : le dossier public/ est introuvable à côté de index.php.\n");
}

// Dossier d'installation vu depuis le navigateur : « » à la racine du domaine, « /badges » en sous-dossier.
// On le déduit de l'emplacement réel de ce fichier sous la racine du site ; à défaut, du nom du script.
$base = null;
$docRoot = realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
$here = realpath(__DIR__);
if ($docRoot && $here && strpos($here . "/", rtrim($docRoot, "/") . "/") === 0) {
    $base = rtrim(str_replace('\\', '/', substr($here, strlen(rtrim($docRoot, '/')))), '/');
}
if ($base === null) {
    $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php');
    $base = basename($script) === 'index.php' ? rtrim(str_replace('\\', '/', dirname($script)), '/') : '';
}

// Chemin demandé après le dossier d'installation (ex. « admin », « admin/ »)
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($base !== '' && strpos($path, $base) === 0) {
    $path = substr($path, strlen($base));
}
$path = ltrim($path, '/');
if ($path === 'index.php') {
    $path = '';
}

// Seules les pages de l'application sont suivies ; tout le reste renvoie à l'accueil
// (jamais src/, data/, bin/ ni config.php, qui ne doivent pas être servis)
$allowed = ['', 'admin', 'admin/', 'diagnostic.php'];
$target = in_array($path, $allowed, true) ? $path : '';
if ($target === 'admin') {
    $target = 'admin/';
}

$query = $_SERVER['QUERY_STRING'] ?? '';
$location = $base . '/public/' . $target . ($query !== '' ? '?' . $query : '');

header('Location: ' . $location, true, 302);
header('Cache-Control: no-store');
header('Content-Type: text/html; charset=utf-8');
$safe = htmlspecialchars($location, ENT_QUOTES, 'UTF-8');
echo "<!doctype html><meta charset=\"utf-8\"><title>Redirection</title>"
   . "<p>Redirection vers <a href=\"$safe\">la déclaration des badges</a>…</p>";
