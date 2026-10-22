-- =====================================================================
--  Déclaration des badges d'accès — schéma de la base (SQLite 3)
-- ---------------------------------------------------------------------
--  L'application crée et met à jour ces tables toute seule au premier
--  accès (src/bootstrap.php, fonction migrate()). Ce script ne sert que
--  si vous voulez créer la base à la main :
--
--      sqlite3 data/badges.sqlite < bin/schema.sql
--
--  Le fichier data/badges.sqlite doit ensuite être accessible en écriture
--  par PHP. Script ré-exécutable sans risque (IF NOT EXISTS).
--  Dates : texte « AAAA-MM-JJ HH:MM:SS », heure de Paris.
-- =====================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------
-- Déclarations des résidents (une par envoi du formulaire)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declarations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lot         TEXT,                 -- numéro de lot sans zéros devant (« 102 » pour 0102)
    nom         TEXT,
    id_syndic   TEXT,                 -- ex. C543210
    email       TEXT,                 -- facultatif, sert à recevoir le code de modification
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decl_email ON declarations(email);

-- ---------------------------------------------------------------------
-- Badges et télécommandes déclarés
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    declaration_id  INTEGER NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
    serial          TEXT NOT NULL UNIQUE,   -- hexadécimal majuscule, unique dans l'immeuble
    stair_a         INTEGER NOT NULL DEFAULT 0,
    stair_b         INTEGER NOT NULL DEFAULT 0,
    stair_c         INTEGER NOT NULL DEFAULT 0,
    parking         INTEGER NOT NULL DEFAULT 0,  -- télécommande de parking
    occupant        TEXT NOT NULL CHECK (occupant IN ('coproprietaire','locataire')),
    tenant_name     TEXT,
    tenant_phone    TEXT,
    tenant_email    TEXT,
    from_central    INTEGER NOT NULL DEFAULT 0,  -- 1 : badge confirmé depuis la liste de la centrale (numéro masqué au résident)
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_badges_decl ON badges(declaration_id);

-- ---------------------------------------------------------------------
-- Lots de l'immeuble et leurs copropriétaires (liste du syndic)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lots (
    numero           TEXT PRIMARY KEY,   -- sans zéros devant
    libelle          TEXT,               -- type : Appartement, Cave, Garage…
    owner_lastname   TEXT,               -- nom, en majuscules
    owner_firstname  TEXT,               -- prénom
    owner_name       TEXT,               -- nom + prénom (servi aux rapprochements)
    owner_login      TEXT                -- identifiant syndic
);

-- ---------------------------------------------------------------------
-- Codes de vérification envoyés par email (stockés hachés)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_codes (
    email         TEXT PRIMARY KEY,
    code_hash     TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,      -- horodatage Unix
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_sent_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------
-- Liste importée de la centrale actuelle (visible seulement en administration)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS known_badges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    position     INTEGER NOT NULL,       -- ordre dans le fichier importé
    name         TEXT,
    identifiant  TEXT,
    raw_serial   TEXT,                   -- tel qu'importé, ex. S-1A2B3C4D
    serial       TEXT                    -- normalisé, ex. 1A2B3C4D (vide si absent ou illisible)
);
CREATE INDEX IF NOT EXISTS idx_known_serial ON known_badges(serial);

-- Réponses des résidents aux badges proposés (« plus en possession », « pas à moi »)
CREATE TABLE IF NOT EXISTS known_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    declaration_id  INTEGER NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
    serial          TEXT NOT NULL,
    answer          TEXT NOT NULL CHECK (answer IN ('perdu','pas_a_moi')),
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_decl ON known_reports(declaration_id);

-- Rapprochements validés : nom de la centrale -> copropriétaire du syndic
CREATE TABLE IF NOT EXISTS central_matches (
    k            TEXT PRIMARY KEY,       -- « NOM|CODESERIE », stable d'un import à l'autre
    status       TEXT NOT NULL CHECK (status IN ('valide','rejete')),
    owner_login  TEXT,                   -- identifiant syndic si validé
    decided_at   TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- Réglages internes et limites de fréquence
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    k      TEXT PRIMARY KEY,             -- ex. central_imported_at
    value  TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
    k             TEXT PRIMARY KEY,      -- action + adresse IP
    hits          INTEGER NOT NULL,
    window_start  INTEGER NOT NULL
);
