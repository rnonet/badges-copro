# Déclaration des badges d'accès

Petite application web pour que les résidents déclarent leurs badges d'accès (escaliers A, B, C), avec lecture automatique du numéro sur photo, accès ultérieur par code email et page d'administration avec export CSV.

PHP 8.1+ et SQLite, sans framework ni étape de compilation.

## Prérequis

- Hébergement PHP 8.1 ou plus récent (OVH, o2switch, Infomaniak, Gandi…), avec les extensions `pdo_sqlite`, `curl`, `openssl` (présentes par défaut presque partout).
- HTTPS activé (Let's Encrypt gratuit chez la plupart des hébergeurs) — indispensable pour l'appareil photo sur mobile et pour la sécurité des sessions.
- Une boîte email pour envoyer les codes (ex. `no-reply@votre-domaine.fr`).
- Facultatif : une clé API Anthropic pour la lecture des photos (sinon lecture locale, moins fiable).

## Installation

1. **Déposer les fichiers** sur l'hébergement (FTP). Idéalement, faire pointer la racine du site (ou du sous-domaine, ex. `badges.votre-domaine.fr`) sur le dossier **`public/`**.
   Si ce n'est pas possible, déposez tout à la racine : le `.htaccess` fourni redirige vers `public/` et bloque `src/`, `data/`, `bin/`, `demo/` et `config.php`. Si la réécriture d'URL n'est pas active chez l'hébergeur, le fichier `index.php` de la racine prend le relais et renvoie le visiteur vers `public/` (et `/admin` vers `public/admin/`), y compris quand l'application est installée dans un sous-dossier (ex. `votre-domaine.fr/badges/`). Sur un serveur **Nginx**, les `.htaccess` sont ignorés : faites impérativement pointer la racine du site sur `public/`, sinon `data/` (la base) resterait accessible.
2. **Créer la configuration** : copier `config.sample.php` en `config.php`, puis remplir :
   - `residence_name`, `contact_email` ;
   - `admin_password_hash` : en ligne de commande, `php bin/hash-password.php "un mot de passe solide"` et coller le résultat. Sans accès SSH, exécutez la commande sur votre ordinateur ;
   - le bloc `smtp` (identifiants de la boîte email). Chez OVH : `ssl0.ovh.net`, port 465, `ssl` ;
   - `anthropic_api_key` si vous voulez la lecture photo par Claude.
3. **Base de données** : par défaut SQLite (un fichier dans `data/`, rien à créer). Pour utiliser **MySQL / MariaDB** (ex. base OVH) :
   - créez la base chez l'hébergeur, puis exécutez `bin/schema-mysql.sql` dans l'onglet SQL de phpMyAdmin (ou `mysql -u UTILISATEUR -p NOM_BASE < bin/schema-mysql.sql`) ;
   - dans `config.php` : `'db_driver' => 'mysql'` et le bloc `mysql` (hôte, nom de la base, utilisateur, mot de passe). Chez OVH, l'hôte ressemble à `xxxxx.mysql.db`.
   - Si l'utilisateur MySQL a le droit de créer des tables, l'application les crée aussi toute seule au premier accès.
4. **Droits d'écriture** : le dossier `data/` doit être accessible en écriture par PHP, même avec MySQL (clé secrète de l'application ; avec SQLite, la base `badges.sqlite` y est créée au premier accès). Les tables sont créées automatiquement ; pour les créer à la main : `sqlite3 data/badges.sqlite < bin/schema.sql`.
5. Ouvrir `https://votre-site/admin/`, se connecter, puis **importer la liste des lots** (onglet « Lots », bouton « Mettre à jour (import) »).
6. Faire un essai complet : déclaration, demande de code sur votre propre email, modification, export CSV.
7. Diffuser le lien de la page aux résidents (affichage dans le hall avec QR code, email du syndic…).

## Utilisation

| Page | Adresse | Pour qui |
| --- | --- | --- |
| Déclaration | `/` | Résidents |
| Modifier une déclaration | `/#modifier` | Résidents ayant laissé un email |
| Administration | `/admin/` | Conseil syndical, gardien |

**Liste des lots** : importez l'export JSON des copropriétaires fourni par le syndic (`data[].lots[].name` = lot, `computedName` = nom, `login` = identifiant syndic). Seuls le numéro et le type de lot, le nom et l'identifiant du copropriétaire sont conservés ; adresses, emails et téléphones sont ignorés. Un CSV simple est aussi accepté (numéro de lot en première colonne, libellé facultatif en deuxième). Une fois la liste importée, un lot inconnu est refusé (réglable avec `strict_lots`). Les numéros s'écrivent avec ou sans zéros devant (« 0102 » = « 102 »).

**Contrôle syndic** : quand l'export JSON est importé, la page d'administration compare chaque déclaration à la liste du syndic (lot, identifiant, nom) et signale celles à vérifier. Rien n'est bloqué : un locataire, par exemple, déclare sous son propre nom. Le résultat figure aussi dans l'export CSV (colonnes `coproprietaire_selon_syndic` et `controle`). Les noms des copropriétaires ne sont jamais envoyés à la page publique.

**Export** : bouton « Exporter en CSV » ; si une recherche ou un filtre est actif, seuls les badges affichés sont exportés. Format : séparateur `;`, UTF-8 avec BOM (s'ouvre directement dans Excel), une ligne par badge.

**Fin de campagne** : exporter le CSV, le remettre au gardien, puis « Purger toutes les déclarations » (suppression définitive). Pensez ensuite à retirer le lien de la page.

## Lots et copropriétaires

Onglet **Lots** de l'administration : un lot par ligne, avec son type, le **nom** et le **prénom** du copropriétaire, son identifiant syndic et le nombre de déclarations reçues.

- **Import** (« Mettre à jour (import) ») : export JSON du syndic, dont le nom est découpé automatiquement (« MARTIN Jean Paul » → nom MARTIN, prénom Jean Paul ; les noms de couples ou de sociétés restent sans prénom), ou CSV `numero ; type ; nom ; prenom ; identifiant_syndic`. L'import remplace toute la liste.
- **Affichage** : trois vues au choix (mémorisées dans le navigateur) : **Par copropriétaire** (vue par défaut ; une personne qui a plusieurs identifiants syndic est regroupée), **Par identifiant syndic**, **Tous les lots** (tableau). Dans les vues regroupées, chaque lot est une pastille cliquable pour le modifier ; un point vert signale un lot déjà déclaré.
- **Affichage** : un sélecteur permet de passer de **Par copropriétaire** (lots regroupés par nom et prénom, avec tous les identifiants syndic de la personne : utile quand un même copropriétaire a plusieurs identifiants), à **Par identifiant syndic** (un groupe par identifiant) ou à **Tous les lots** (une ligne par lot). Chaque groupe indique le nombre de lots, leur répartition par type et les déclarations reçues ; un clic sur un lot ouvre sa fiche. Le choix d'affichage est mémorisé dans le navigateur.
- **Modification** : bouton « Modifier » sur chaque lot (ou clic sur le lot dans les vues regroupées). Le nom et le prénom suivent l'identifiant syndic : les corriger sur un lot les met à jour sur tous les lots du même copropriétaire. Pour une vente, saisir le nouvel identifiant et le nouveau nom sur le lot concerné. Saisir un identifiant existant reprend le nom de ce copropriétaire.
- **Ajout / suppression** d'un lot ; un lot supprimé n'est plus accepté dans le formulaire (les déclarations qui le citent sont signalées « lot inconnu »).
- **Téléchargement (CSV)** dans le format de l'import : télécharger, corriger dans Excel, réimporter.
- La page publique ne reçoit que les numéros et types de lot, jamais les noms.

## Télécommandes de parking

Dans la fenêtre « Ajouter un badge », la case **Télécommande de parking** indique que l'objet déclaré ouvre le parking. Il faut cocher au moins un escalier **ou** cette case ; le numéro de série reste obligatoire. Dans l'administration : colonne « Accès », filtre « Télécommande de parking », compteur, et colonne `telecommande_parking` (oui / non) dans l'export CSV, après `escalier_C`.

## Liste de la centrale actuelle

Onglet **Centrale actuelle** de l'administration, visible uniquement par le conseil syndical et le syndic (mot de passe administrateur).

- **Import / mise à jour** : bouton « Mettre à jour (nouvel import) ». Fichier texte tabulé ou CSV avec les colonnes `Nom`, `Identifiant`, `Code Série` (ex. `S-1A2B3C4D`), en UTF-8 ou Windows-1252. Le nouvel import remplace la liste ; les réponses des résidents sont conservées, car elles sont rattachées aux codes série.
- **Téléchargement** : bouton « Télécharger la liste (CSV) », avec pour chaque badge son statut (`Déclaré`, `Plus en possession`, `Refusé par le résident`, `Non déclaré`, `Sans numéro de série`), qui l'a déclaré ou signalé, la date et les codes en double. Si un filtre est actif, seules les lignes affichées sont téléchargées.
- **Propositions aux résidents** : pendant la saisie, les badges dont le nom correspond à l'identité déclarée (nom saisi, copropriétaire du lot ou de l'identifiant syndic selon la liste du syndic) sont proposés. Le résident indique s'il l'a toujours (le badge rejoint sa déclaration), s'il ne l'a plus, ou si ce n'est pas le sien. Le filtre « Plus en possession » donne la liste des badges à désactiver.
- **Confidentialité** : la page publique ne reçoit jamais la liste. Un badge proposé n'est montré que par ses 4 derniers caractères (« se terminant par 3C4D »), sans le nom figurant dans la liste ; le code complet reste sur le serveur, y compris quand le résident consulte ou modifie sa déclaration. Les mots génériques (Gardien, Syndic, Mise en service…) ne déclenchent pas de proposition.
- Les réponses « plus en possession » sont déclaratives : vérifiez-les avant de désactiver un badge (la colonne Détail indique qui a répondu).

## Rapprochement centrale / syndic

Onglet **Rapprochement** de l'administration (disponible une fois les deux listes importées). Pour chaque nom de la centrale (les lignes simplement numérotées sont ignorées), l'application propose le ou les copropriétaires de la liste du syndic dont le nom correspond, avec leur identifiant et leurs lots :

- **Sûr** : tous les mots du nom retrouvés chez un seul copropriétaire (ex. MARTIN → MARTIN Paul, C500001) ;
- **Probable** : nom partiel ou plusieurs homonymes (ex. LEROY → LEROY Anne ou LEROY Paul), orthographe approchée (ROUSEL / ROUSSEL) ;
- **Aucune proposition** : nom absent de la liste du syndic (ancien propriétaire, locataire, gardien…).

Pour chaque ligne : **Valider** (le copropriétaire choisi dans la liste déroulante, qui contient aussi tous les autres copropriétaires), **Aucun copropriétaire**, ou **Annuler la décision**. Le bouton « Valider les correspondances sûres » traite d'un coup les cas sûrs.

Effet : un badge rapproché est proposé au résident qui saisit le lot ou l'identifiant syndic de ce copropriétaire, même si les noms diffèrent (ex. un badge au nom du gérant rapproché d'une SCI propriétaire). Un badge marqué « aucun copropriétaire » n'est plus proposé via le lot ou l'identifiant, seulement si le résident tape lui-même ce nom. Les décisions sont conservées lors d'un nouvel import (elles sont rattachées au nom et au code série) et figurent dans le téléchargement de la liste (colonnes `rapprochement`, `coproprietaire`, `identifiant_syndic`, `lots`).

## Lecture des photos

- Avec `anthropic_api_key` : l'image est réduite à 1600 px dans le navigateur, envoyée au serveur, puis à l'API Anthropic (modèle `anthropic_model`, Claude Haiku par défaut). Le numéro proposé pré-remplit le champ ; s'il y a plusieurs suites lisibles, le résident choisit. Coût : une fraction de centime par photo (vérifier les tarifs sur claude.com/pricing). Limite : `ocr_max_per_hour` lectures par adresse IP et par heure.
- Sans clé : lecture dans le navigateur avec Tesseract.js (chargé depuis cdn.jsdelivr.net à la première photo). Gratuit, mais peu fiable sur les petits numéros gravés.
- Dans les deux cas, **la photo n'est jamais enregistrée**.

## Sécurité

- Requêtes préparées, jeton CSRF sur toutes les actions, cookies de session `HttpOnly` / `Secure` / `SameSite=Lax`.
- Mot de passe admin et codes email stockés hachés ; code à 6 chiffres valable 15 minutes, 5 essais, un envoi par minute ; réponse identique que l'email soit connu ou non.
- Limites de fréquence : envois de déclarations, demandes de code, connexions admin, lectures photo.
- Champ piège anti-robot ; neutralisation des formules dans l'export CSV.
- Les pages ne sont pas indexées par les moteurs de recherche (`noindex`).

## Tests en local

```bash
cp config.sample.php config.php   # puis : 'mail_transport' => 'log', 'secure_cookies' => false
php -S 127.0.0.1:8000 -t public
```

Les emails sont alors écrits dans `data/mail.log` au lieu d'être envoyés.

## Structure

```
public/            racine web
  index.php        page résident (HTML préparé par PHP)
  admin/index.php  page d'administration
  api.php          API JSON (toutes les actions)
  assets/          CSS et JavaScript
src/               code PHP (base, validation, email, lecture photo ; page.php : préparation des pages)
data/              base SQLite (non accessible depuis le web)
bin/               outil de hachage du mot de passe, schémas SQL (schema.sql pour SQLite, schema-mysql.sql pour MySQL)
config.sample.php  modèle de configuration
index.php          redirection vers public/ (si la racine du site ne pointe pas sur public/)
```
