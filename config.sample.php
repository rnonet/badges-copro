<?php
/**
 * Configuration — copier ce fichier en config.php et l'adapter.
 * config.php ne doit jamais être accessible depuis le web (il est hors de public/).
 */
return [
    // Nom affiché en haut de la page
    'residence_name' => 'Résidence — Vincennes',

    // Email de contact du conseil syndical (affiché dans la notice RGPD)
    'contact_email' => 'conseil.syndical@exemple.fr',

    // Mot de passe administrateur : hash généré avec  php bin/hash-password.php
    'admin_password_hash' => '',

    // Fichier SQLite (le dossier doit être accessible en écriture par PHP)
    'db_path' => __DIR__ . '/data/badges.sqlite',

    // Format de l'identifiant syndic (expression régulière, insensible à la casse)
    'syndic_id_pattern' => '/^[A-Z][0-9]{6}$/i',

    // Longueur autorisée du numéro de série hexadécimal
    'serial_min_length' => 4,
    'serial_max_length' => 32,

    // Refuser un numéro de lot absent de la liste importée (si une liste est importée)
    'strict_lots' => true,

    // ---------- Lecture automatique du numéro sur photo ----------
    // Clé API Anthropic (https://console.anthropic.com). Vide = lecture locale Tesseract.js
    'anthropic_api_key' => '',
    'anthropic_model'   => 'claude-haiku-5-5',
    // Nombre maximal de lectures photo par adresse IP et par heure
    'ocr_max_per_hour'  => 10,

    // ---------- Envoi des emails (codes de vérification) ----------
    // 'smtp' (recommandé), 'mail' (fonction mail() de PHP) ou 'log' (écrit dans data/mail.log, pour les tests)
    'mail_transport' => 'smtp',
    'mail_from'      => 'no-reply@exemple.fr',
    'mail_from_name' => 'Badges — Conseil syndical',
    'smtp' => [
        'host'       => 'ssl0.ovh.net',
        'port'       => 465,          // 465 = SSL, 587 = STARTTLS
        'encryption' => 'ssl',        // 'ssl', 'tls' ou ''
        'username'   => 'no-reply@exemple.fr',
        'password'   => '',
        'timeout'    => 15,
    ],

    // Mettre à false uniquement pour des tests en local sans HTTPS
    'secure_cookies' => true,
];
