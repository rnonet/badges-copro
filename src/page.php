<?php
declare(strict_types=1);

/**
 * Préparation commune des pages PHP (résident et administration).
 *
 * Fournit le contexte affiché par la page : nom de la résidence, contact, liste des lots,
 * et les données de départ du JavaScript (jeton de sécurité, réglages), ce qui évite
 * un aller-retour vers l'API au chargement.
 *
 * BADGES_STATIC=1 (construction de la démo) : aucune base ni session, valeurs neutres.
 */
function page_context(): array
{
    $ctx = ['residence' => 'Vincennes', 'contact' => '', 'lots' => [], 'boot' => null];
    if (getenv('BADGES_STATIC') === '1') {
        return $ctx;
    }
    require_once __DIR__ . '/bootstrap.php';
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store'); // la page contient le jeton de sécurité de la session
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Frame-Options: DENY');
    $ctx['residence'] = (string) config('residence_name');
    $ctx['contact'] = (string) config('contact_email');
    try {
        start_session();
        $boot = session_payload();
        $ctx['lots'] = $boot['lots'];
        $ctx['boot'] = $boot;
    } catch (Throwable $e) {
        // Base indisponible : la page s'affiche quand même, le JavaScript réessaiera via l'API
        error_log('badges page: ' . $e->getMessage());
    }
    return $ctx;
}

function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

/** Script de démarrage injecté dans la page */
function boot_script(?array $boot): string
{
    if ($boot === null) {
        return '';
    }
    $json = json_encode($boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE);
    return "<script>window.APP_BOOT = $json;</script>\n";
}
