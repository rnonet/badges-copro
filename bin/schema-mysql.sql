-- =====================================================================
--  Déclaration des badges d'accès — schéma de la base (MySQL 5.7+ / MariaDB 10.3+)
-- ---------------------------------------------------------------------
--  À exécuter une fois, dans la base créée chez l'hébergeur (onglet SQL
--  de phpMyAdmin, ou :  mysql -u UTILISATEUR -p NOM_BASE < bin/schema-mysql.sql).
--  Script ré-exécutable sans risque (IF NOT EXISTS).
--
--  Puis, dans config.php :  'db_driver' => 'mysql'  et le bloc 'mysql'
--  (hôte, nom de la base, utilisateur, mot de passe).
--  Si l'utilisateur MySQL a le droit CREATE, l'application crée aussi
--  ces tables toute seule au premier accès.
--
--  Jeu de caractères utf8mb4 (accents, emojis). Les colonnes servant de
--  clé technique (numéros de série, clés de rapprochement…) sont en
--  utf8mb4_bin : comparaison exacte, sensible à la casse et aux accents.
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- Déclarations des résidents (une par envoi du formulaire)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declarations (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    lot         VARCHAR(8)   NULL COMMENT 'numéro de lot sans zéros devant (102 pour 0102)',
    nom         VARCHAR(120) NULL,
    id_syndic   VARCHAR(20)  NULL COMMENT 'ex. C543210',
    email       VARCHAR(191) NULL COMMENT 'facultatif : reçoit le code de modification',
    created_at  DATETIME     NOT NULL,
    updated_at  DATETIME     NOT NULL,
    PRIMARY KEY (id),
    KEY idx_decl_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Badges et télécommandes déclarés
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    declaration_id  INT UNSIGNED NOT NULL,
    serial          VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'hexadécimal majuscule, unique dans l''immeuble',
    stair_a         TINYINT(1)  NOT NULL DEFAULT 0,
    stair_b         TINYINT(1)  NOT NULL DEFAULT 0,
    stair_c         TINYINT(1)  NOT NULL DEFAULT 0,
    parking         TINYINT(1)  NOT NULL DEFAULT 0 COMMENT 'télécommande de parking',
    occupant        VARCHAR(20) NOT NULL,
    tenant_name     VARCHAR(120) NULL,
    tenant_phone    VARCHAR(20)  NULL,
    tenant_email    VARCHAR(191) NULL,
    from_central    TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '1 : confirmé depuis la liste de la centrale (numéro masqué au résident)',
    created_at      DATETIME    NOT NULL,
    updated_at      DATETIME    NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_badges_serial (serial),
    KEY idx_badges_decl (declaration_id),
    CONSTRAINT fk_badges_decl FOREIGN KEY (declaration_id) REFERENCES declarations (id) ON DELETE CASCADE,
    CONSTRAINT ck_badges_occupant CHECK (occupant IN ('coproprietaire', 'locataire'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Lots de l'immeuble et leurs copropriétaires (liste du syndic)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lots (
    numero           VARCHAR(8)   CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'sans zéros devant',
    libelle          VARCHAR(120) NULL COMMENT 'type : Appartement, Cave, Garage…',
    owner_lastname   VARCHAR(120) NULL COMMENT 'nom, en majuscules',
    owner_firstname  VARCHAR(120) NULL COMMENT 'prénom',
    owner_name       VARCHAR(241) NULL COMMENT 'nom + prénom (servi aux rapprochements)',
    owner_login      VARCHAR(20)  NULL COMMENT 'identifiant syndic',
    PRIMARY KEY (numero),
    KEY idx_lots_login (owner_login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Codes de vérification envoyés par email (stockés hachés)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_codes (
    email         VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    code_hash     VARCHAR(255) NOT NULL,
    expires_at    BIGINT       NOT NULL COMMENT 'horodatage Unix',
    attempts      INT          NOT NULL DEFAULT 0,
    last_sent_at  BIGINT       NOT NULL,
    PRIMARY KEY (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Liste importée de la centrale actuelle (visible seulement en administration)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS known_badges (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    position     INT          NOT NULL COMMENT 'ordre dans le fichier importé',
    name         VARCHAR(120) NULL,
    identifiant  VARCHAR(40)  NULL,
    raw_serial   VARCHAR(40)  NULL COMMENT 'tel qu''importé, ex. S-1A2B3C4D',
    serial       VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL COMMENT 'normalisé, ex. 1A2B3C4D (vide si absent)',
    PRIMARY KEY (id),
    KEY idx_known_serial (serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Réponses des résidents aux badges proposés (« plus en possession », « pas à moi »)
CREATE TABLE IF NOT EXISTS known_reports (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    declaration_id  INT UNSIGNED NOT NULL,
    serial          VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    answer          VARCHAR(20) NOT NULL,
    created_at      DATETIME    NOT NULL,
    PRIMARY KEY (id),
    KEY idx_reports_decl (declaration_id),
    CONSTRAINT fk_reports_decl FOREIGN KEY (declaration_id) REFERENCES declarations (id) ON DELETE CASCADE,
    CONSTRAINT ck_reports_answer CHECK (answer IN ('perdu', 'pas_a_moi'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rapprochements validés : nom de la centrale -> copropriétaire du syndic
CREATE TABLE IF NOT EXISTS central_matches (
    k            VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'NOM|CODESERIE, stable d''un import à l''autre',
    status       VARCHAR(10)  NOT NULL,
    owner_login  VARCHAR(20)  NULL COMMENT 'identifiant syndic si validé',
    decided_at   DATETIME     NOT NULL,
    PRIMARY KEY (k),
    CONSTRAINT ck_matches_status CHECK (status IN ('valide', 'rejete'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Réglages internes et limites de fréquence
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    k      VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'ex. central_imported_at',
    value  TEXT NULL,
    PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
    k             VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'action + adresse IP',
    hits          INT    NOT NULL,
    window_start  BIGINT NOT NULL,
    PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
