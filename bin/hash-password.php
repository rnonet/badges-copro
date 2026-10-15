<?php
// Usage : php bin/hash-password.php "mon mot de passe"
// Copiez le résultat dans config.php, clé admin_password_hash.
if ($argc < 2) {
    fwrite(STDERR, "Usage : php bin/hash-password.php \"mot de passe\"\n");
    exit(1);
}
if (strlen($argv[1]) < 10) {
    fwrite(STDERR, "Choisissez un mot de passe d'au moins 10 caractères.\n");
    exit(1);
}
echo password_hash($argv[1], PASSWORD_DEFAULT), PHP_EOL;
