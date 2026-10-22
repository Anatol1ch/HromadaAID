import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateAddresses } from './migration-addresses.js'
import { BankMigrationError, migrateBanks } from './migration-banks.js'
import { migrateAssignmentStatuses } from './migration-assignment-statuses.js'

type Migration = { version: number; sql: string }

const migrations: Migration[] = [{
  version: 1,
  sql: `
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE programs (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      short_name TEXT NOT NULL,
      official_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE TABLE aid_types (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      program_id TEXT NOT NULL REFERENCES programs(id),
      short_name TEXT NOT NULL,
      official_name TEXT NOT NULL,
      direction TEXT,
      funding_source TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE TABLE recipients (
      id TEXT PRIMARY KEY,
      last_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      patronymic TEXT,
      rnokpp TEXT COLLATE NOCASE UNIQUE,
      sex TEXT CHECK (sex IS NULL OR sex IN ('Жінка', 'Чоловік')),
      address TEXT,
      registered_address TEXT,
      phone TEXT,
      email TEXT,
      bank_account TEXT,
      bank_name TEXT,
      bank_mfo TEXT,
      bank_edrpou TEXT,
      passport TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE decisions (
      id TEXT PRIMARY KEY,
      decision_number TEXT NOT NULL,
      decision_date TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (decision_number, decision_date)
    );

    CREATE TABLE assignments (
      id TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL REFERENCES recipients(id),
      decision_id TEXT NOT NULL REFERENCES decisions(id),
      aid_type_id TEXT NOT NULL REFERENCES aid_types(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      status TEXT NOT NULL DEFAULT 'Призначено' CHECK (status IN ('Призначено', 'В роботі', 'Виплачено')),
      direction TEXT,
      funding_source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE payouts (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      paid_on TEXT,
      payment_reference TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE document_batches (
      id TEXT PRIMARY KEY,
      template_code TEXT NOT NULL,
      template_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE document_recipient_snapshots (
      id TEXT PRIMARY KEY,
      document_batch_id TEXT NOT NULL REFERENCES document_batches(id),
      recipient_id TEXT REFERENCES recipients(id) ON DELETE SET NULL,
      recipient_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_assignments_recipient ON assignments(recipient_id);
    CREATE INDEX idx_assignments_decision ON assignments(decision_id);
    CREATE INDEX idx_payouts_assignment ON payouts(assignment_id);
    CREATE INDEX idx_recipient_name ON recipients(last_name, first_name, patronymic);
  `,
}, {
  version: 2,
  sql: `
    ALTER TABLE decisions ADD COLUMN updated_at TEXT;
    ALTER TABLE assignments ADD COLUMN updated_at TEXT;
    UPDATE decisions SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE assignments SET updated_at = created_at WHERE updated_at IS NULL;
    CREATE INDEX idx_assignments_decision_date ON assignments(decision_id, created_at);
  `,
}, {
  version: 3,
  sql: `
    ALTER TABLE recipients ADD COLUMN archived_at TEXT;
    ALTER TABLE payouts ADD COLUMN voided_at TEXT;
    ALTER TABLE payouts ADD COLUMN void_reason TEXT;
    CREATE INDEX idx_recipients_archived ON recipients(archived_at);
    CREATE INDEX idx_payouts_assignment_active ON payouts(assignment_id, voided_at);
  `,
}, {
  version: 4,
  sql: `
    ALTER TABLE recipients ADD COLUMN is_vpo INTEGER CHECK (is_vpo IS NULL OR is_vpo IN (0, 1));
    CREATE TABLE imported_source_rows (
      id TEXT PRIMARY KEY,
      source_hash TEXT NOT NULL,
      worksheet TEXT NOT NULL,
      source_row_number INTEGER NOT NULL,
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      imported_at TEXT NOT NULL,
      UNIQUE (source_hash, worksheet, source_row_number)
    );
    CREATE TABLE import_review_items (
      id TEXT PRIMARY KEY,
      import_source_row_id TEXT NOT NULL REFERENCES imported_source_rows(id),
      reason TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX idx_import_review_open ON import_review_items(resolved_at);
  `,
}, {
  version: 5,
  sql: `
    CREATE TABLE reporting_source_rows (
      id TEXT PRIMARY KEY,
      source_hash TEXT NOT NULL,
      worksheet TEXT NOT NULL,
      source_row_number INTEGER NOT NULL,
      item_label TEXT,
      data_json TEXT NOT NULL,
      formulas_json TEXT NOT NULL,
      report_as_of TEXT,
      UNIQUE (source_hash, worksheet, source_row_number)
    );
    CREATE INDEX idx_reporting_source_sheet ON reporting_source_rows(source_hash, worksheet, source_row_number);
  `,
}, {
  version: 6,
  sql: `
    CREATE TABLE annual_plan_entries (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
      aid_type_id TEXT NOT NULL REFERENCES aid_types(id) ON DELETE RESTRICT,
      reference_label TEXT NOT NULL,
      planned_recipient_count INTEGER CHECK (planned_recipient_count IS NULL OR planned_recipient_count >= 0),
      planned_amount_minor INTEGER NOT NULL CHECK (planned_amount_minor >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (year, aid_type_id, reference_label)
    );
    CREATE INDEX idx_annual_plan_year_type ON annual_plan_entries(year, aid_type_id);
  `,
}, {
  version: 7,
  sql: `
    UPDATE aid_types SET short_name='На лікування хворим, онкохворим' WHERE code='SOCIAL_TREATMENT' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='Ліквідаторам ЧАЕС' WHERE code='SOCIAL_CHERNOBYL' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='На лікування поранень внаслідок атаки' WHERE code='SOCIAL_ATTACK_INJURY' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='Щорічна військовослужбовцям' WHERE code='VETERANS_ANNUAL_SERVICE' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='Щорічна сім’ям загиблих(померлих)' WHERE code='VETERANS_FAMILIES' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='Одноразова на лікування поранень' WHERE code='VETERANS_WOUNDS' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='Одноразова на поховання (загиблим)' WHERE code='VETERANS_FUNERAL_KILLED' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='Одноразова на поховання (померлим)' WHERE code='VETERANS_FUNERAL_DECEASED' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='Щорічна сім’ям безвісти зниклих' WHERE code='VETERANS_MISSING_FAMILY' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
    UPDATE aid_types SET short_name='Одноразова після полону' WHERE code='VETERANS_RELEASE' AND NOT EXISTS (SELECT 1 FROM assignments WHERE aid_type_id=aid_types.id);
  `,
}, {
  version: 8,
  sql: `
    UPDATE aid_types SET is_active=0 WHERE code IN ('SOCIAL_DEPUTY_CHILDREN', 'SOCIAL_DEPUTY_ADULTS');
    UPDATE aid_types SET short_name='Допомога за пропозиціями депутатів обласної ради' WHERE code='SOCIAL_DEPUTY_PROPOSALS';
  `,
}, {
  version: 9,
  sql: `
    CREATE TABLE program_approvals (
      id TEXT PRIMARY KEY,
      document_number TEXT NOT NULL,
      document_date TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (document_number, document_date)
    );
    ALTER TABLE programs ADD COLUMN approval_id TEXT REFERENCES program_approvals(id) ON DELETE SET NULL;
    UPDATE aid_types SET is_active=0 WHERE code='SOCIAL_WAR_EMERGENCY';
  `,
}, {
  version: 10,
  sql: `UPDATE aid_types SET is_active=0 WHERE code='SOCIAL_WAR_EMERGENCY';`,
}, {
  version: 11,
  sql: `
    ALTER TABLE programs ADD COLUMN approval_number TEXT;
    ALTER TABLE programs ADD COLUMN approval_date TEXT;
    ALTER TABLE programs ADD COLUMN approval_title TEXT;
    UPDATE programs SET
      approval_number=(SELECT document_number FROM program_approvals WHERE id=programs.approval_id),
      approval_date=(SELECT document_date FROM program_approvals WHERE id=programs.approval_id),
      approval_title=(SELECT title FROM program_approvals WHERE id=programs.approval_id)
      WHERE approval_id IS NOT NULL;
  `,
}, {
  version: 12,
  sql: `UPDATE recipients SET archived_at=NULL WHERE archived_at IS NOT NULL;`,
}, {
  version: 13,
  // The migration record marks adoption of one-time initialization. Existing databases
  // are deliberately adopted as-is, regardless of missing or deleted catalog entries.
  // For a new database this marker and its seed are committed in the same transaction.
  sql: `SELECT 1;`,
}, {
  version: 14,
  // Processing metadata belongs to the assignment; do not revive payout accounting.
  // Preserve valid dates from the latest active historical payment where available.
  sql: `
    ALTER TABLE assignments ADD COLUMN paid_on TEXT;
    UPDATE assignments SET paid_on = (
      SELECT p.paid_on FROM payouts p
      WHERE p.assignment_id = assignments.id AND p.voided_at IS NULL
        AND length(p.paid_on) = 10 AND date(p.paid_on, '+0 days') = p.paid_on
      ORDER BY p.created_at DESC, p.id DESC LIMIT 1
    );
  `,
}, {
  version: 15,
  // Rebuild only the status constraint; preserve every historical value.
  sql: 'SELECT 1;',
}, {
  version: 16,
  sql: 'SELECT 1;',
}, {
  version: 17,
  sql: 'SELECT 1;',
}, {
  version: 18,
  sql: `
    ALTER TABLE programs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0);
    ALTER TABLE aid_types ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0);
    WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY short_name,id)-1 AS position FROM programs)
      UPDATE programs SET sort_order=(SELECT position FROM ordered WHERE ordered.id=programs.id);
    WITH ordered AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY program_id ORDER BY short_name,id)-1 AS position FROM aid_types)
      UPDATE aid_types SET sort_order=(SELECT position FROM ordered WHERE ordered.id=aid_types.id);
    CREATE INDEX idx_programs_sort ON programs(sort_order,id);
    CREATE INDEX idx_aid_types_sort ON aid_types(program_id,sort_order,id);
  `,
}, {
  version: 19,
  sql: `
    CREATE TABLE annual_aid_plans (
      year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2200),
      aid_type_id TEXT NOT NULL REFERENCES aid_types(id) ON DELETE RESTRICT,
      planned_recipient_count INTEGER CHECK(planned_recipient_count IS NULL OR planned_recipient_count>=0),
      planned_amount_minor INTEGER NOT NULL CHECK(planned_amount_minor>=0),
      budget_amount_minor INTEGER CHECK(budget_amount_minor IS NULL OR budget_amount_minor>=0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(year,aid_type_id)
    );
    INSERT INTO annual_aid_plans(year,aid_type_id,planned_recipient_count,planned_amount_minor,budget_amount_minor,updated_at)
      SELECT year,aid_type_id,SUM(planned_recipient_count),SUM(planned_amount_minor),NULL,MAX(updated_at)
      FROM annual_plan_entries GROUP BY year,aid_type_id;
    CREATE INDEX idx_annual_aid_plans_type ON annual_aid_plans(aid_type_id,year);
  `,
}, {
  // Version tokens for optimistic bank edits. Existing records retain all
  // content and receive a migration-time revision before remote writes begin.
  version: 20,
  sql: `
    ALTER TABLE banks ADD COLUMN updated_at TEXT;
    UPDATE banks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at IS NULL;
  `,
}, {
  version: 21,
  sql: `
    ALTER TABLE programs ADD COLUMN updated_at TEXT;
    ALTER TABLE aid_types ADD COLUMN updated_at TEXT;
    UPDATE programs SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;
    UPDATE aid_types SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE updated_at IS NULL;
    CREATE TABLE catalog_order_revisions (scope TEXT PRIMARY KEY, revision TEXT NOT NULL);
    INSERT INTO catalog_order_revisions(scope,revision) VALUES ('programs',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    INSERT INTO catalog_order_revisions(scope,revision) SELECT 'aid-types:'||id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM programs;
  `,
}, {
  version: 22,
  sql: `
    CREATE TABLE decision_assignment_requests (
      request_id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      payload_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_decision_assignment_requests_decision ON decision_assignment_requests(decision_id,created_at);
  `,
}, {
  version: 23,
  sql: `
    CREATE TABLE assignment_save_requests (
      request_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `,
}, {
  version: 24,
  sql: `
    CREATE TABLE assignment_status_requests (
      request_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `,
}, {
  version: 25,
  sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL CHECK(length(trim(username)) BETWEEN 3 AND 80),
      username_key TEXT NOT NULL UNIQUE CHECK(length(trim(username_key)) BETWEEN 3 AND 80),
      display_name TEXT CHECK(display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 150),
      password_hash TEXT NOT NULL CHECK(length(password_hash) > 0),
      status TEXT NOT NULL CHECK(status IN ('active','inactive','blocked')),
      password_changed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('administrator','assignment_specialist','payment_specialist','planning_specialist','viewer')),
      PRIMARY KEY(user_id,role)
    );
    CREATE TABLE user_sessions (
      token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL CHECK(expires_at > created_at)
    );
    CREATE INDEX idx_user_roles_user ON user_roles(user_id);
    CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at);
    CREATE TRIGGER users_revoke_sessions_after_status_change
    AFTER UPDATE OF status ON users
    WHEN NEW.status <> OLD.status
    BEGIN
      DELETE FROM user_sessions WHERE user_id=NEW.id;
    END;
    CREATE TRIGGER users_revoke_sessions_after_password_change
    AFTER UPDATE OF password_hash ON users
    WHEN NEW.password_hash <> OLD.password_hash
    BEGIN
      DELETE FROM user_sessions WHERE user_id=NEW.id;
    END;
    CREATE TRIGGER user_roles_revoke_sessions_after_insert
    AFTER INSERT ON user_roles
    BEGIN
      DELETE FROM user_sessions WHERE user_id=NEW.user_id;
    END;
    CREATE TRIGGER user_roles_revoke_sessions_after_delete
    AFTER DELETE ON user_roles
    BEGIN
      DELETE FROM user_sessions WHERE user_id=OLD.user_id;
    END;
    CREATE TRIGGER user_roles_revoke_sessions_after_update
    AFTER UPDATE OF role ON user_roles
    BEGIN
      DELETE FROM user_sessions WHERE user_id=NEW.user_id;
    END;
  `,
}, {
  version: 26,
  sql: `
    ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
  `,
}, {
  version: 27,
  sql: `
    ALTER TABLE users ADD COLUMN first_name TEXT CHECK(first_name IS NULL OR length(trim(first_name)) BETWEEN 1 AND 100);
    ALTER TABLE users ADD COLUMN last_name TEXT CHECK(last_name IS NULL OR length(trim(last_name)) BETWEEN 1 AND 100);
  `,
}, {
  version: 28,
  sql: `
    CREATE TABLE backup_installations (
      id TEXT PRIMARY KEY,
      credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64),
      computer_name TEXT NOT NULL CHECK(length(computer_name) BETWEEN 1 AND 100),
      backup_allowed INTEGER NOT NULL DEFAULT 0 CHECK(backup_allowed IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_backup_at TEXT
    );
  `,
}]

const maximumSupportedSchemaVersion = Math.max(...migrations.map(({ version }) => version))

export class DatabaseSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseSchemaError'
  }
}

export class DatabaseIntegrityError extends Error {
  constructor(kind: 'corruption' | 'foreign-keys') {
    super(kind === 'corruption'
      ? 'Виявлено пошкодження бази даних HromadaAID. Запуск зупинено. Автоматичне відновлення не виконувалося. Зверніться до відповідального за технічну підтримку.'
      : 'Виявлено порушення зв’язків між записами бази даних HromadaAID. Запуск зупинено. Проблемні записи не змінювалися й не видалялися. Зверніться до відповідального за технічну підтримку.')
    this.name = 'DatabaseIntegrityError'
  }
}

function checkDatabaseIntegrity(database: DatabaseSync) {
  const results = database.prepare('PRAGMA quick_check').all()
  if (results.length !== 1 || results[0].quick_check !== 'ok') {
    // SQLite's diagnostic rows may contain record details: never expose them.
    throw new DatabaseIntegrityError('corruption')
  }
}

function checkForeignKeys(database: DatabaseSync) {
  // No application-table assumptions: this also supports every historical schema
  // and an empty database before its first migration. One violation is enough.
  if (database.prepare('PRAGMA foreign_key_check').get()) {
    throw new DatabaseIntegrityError('foreign-keys')
  }
}

const programs = [
  {
    id: 'program-social', code: 'SOCIAL_PROTECTION', shortName: 'Програма соціального захисту',
    officialName: 'Комплексна Програма соціального захисту населення Вишнівської селищної територіальної громади на 2026-2030 роки (зі змінами та доповненнями)',
  },
  {
    id: 'program-veterans', code: 'VETERAN_SUPPORT', shortName: 'Програма підтримки ветеранів',
    officialName: 'Програма підтримки ветеранів війни та членів їх сімей, членів сімей загиблих (померлих) ветеранів війни, членів сімей загиблих (померлих) Захисників та Захисниць України на 2026-2030 роки (зі змінами та доповненнями)',
  },
]

const aidTypes = [
  { id: 'aid-social-treatment', code: 'SOCIAL_TREATMENT', programId: 'program-social', shortName: 'Допомога на лікування', officialName: 'Матеріальна допомоги на лікування хворим і онкохворим громадянам, особам які постраждали внаслідок надзвичайних ситуацій та соціально-незахищеним верствам населення, які опинилися в складній життєвій ситуації' },
  { id: 'aid-social-chernobyl', code: 'SOCIAL_CHERNOBYL', programId: 'program-social', shortName: 'Допомога ліквідаторам ЧАЕС', officialName: 'Матеріальна допомога ліквідаторам аварії на ЧАЕС' },
  { id: 'aid-social-attack-injury', code: 'SOCIAL_ATTACK_INJURY', programId: 'program-social', shortName: 'На лікування поранень внаслідок атаки', officialName: 'Надання матеріальної допомоги особам, які постраждали внаслідок виникнення надзвичайної ситуації воєнного характеру - збройної агресії російської федерації проти України (внаслідок якого завдано шкоду здоров’ю потерпілому, його майну чи житлу)' },
  { id: 'aid-social-deputy-proposals', code: 'SOCIAL_DEPUTY_PROPOSALS', programId: 'program-social', shortName: 'Допомога за пропозиціями депутатів обласної ради', officialName: 'Матеріальна допомога громадянам, згідно пропозицій від депутатів обласної ради', direction: 'За пропозиціями депутатів обласної ради', fundingSource: 'Субвенція з обласного бюджету на фінансування видатків, згідно пропозицій від депутатів обласної ради' },
  { id: 'aid-veterans-annual-service', code: 'VETERANS_ANNUAL_SERVICE', programId: 'program-veterans', shortName: 'Щорічна допомога військовослужбовцям', officialName: 'Щорічна одноразова матеріальна допомога військовослужбовцям, які захищали незалежність, суверенітет та територіальну цілісність України і брали безпосередню участь в антитерористичній операції, забезпеченні її проведення, перебуваючи безпосередньо в районах антитерористичної операції у період її проведення, у здійсненні заходів із забезпечення національної безпеки і оборони, відсічі і стримування збройної агресії Російської Федерації у Донецькій та Луганській областях, забезпеченні їх здійснення, перебуваючи безпосередньо в районах та у період здійснення зазначених заходів, у заходах, необхідних для забезпечення оборони України, захисту безпеки населення та інтересів держави у зв’язку з військовою агресією Російської Федерації проти України; учасникам бойових дій в Афганістані (воїнам-афганцям) до Дня виведення військ з Афганістану' },
  { id: 'aid-veterans-families', code: 'VETERANS_FAMILIES', programId: 'program-veterans', shortName: 'Допомога сім’ям загиблих', officialName: 'Щорічна одноразова матеріальна допомога до Дня захисників та захисниць України сім’ям загиблих (померлих) військовослужбовців, та учасників антитерористичної операції, які брали безпосередню участь у бойових діях з оборони України, захисті її суверенітету, територіальної цілісності та недоторканності, в складі військ (сил) Збройних сил України та інших військових формуваннях (в тому числі, підрозділів територіальної оборони)' },
  { id: 'aid-veterans-wounds', code: 'VETERANS_WOUNDS', programId: 'program-veterans', shortName: 'Допомога на лікування поранень', officialName: 'Одноразова адресна грошова допомога на лікування поранень, контузії чи каліцтва, отриманих при Захисті Батьківщини' },
  { id: 'aid-veterans-funeral-killed', code: 'VETERANS_FUNERAL_KILLED', programId: 'program-veterans', shortName: 'Допомога на поховання сім’ї загиблого', officialName: 'Одноразова матеріальна допомога на поховання, сім’ям загиблих військовослужбовців, які брали безпосередню участь у бойових діях з оборони України, захист її суверенітету, територіальної цілісності та недоторканості в період режиму воєнного стану' },
  { id: 'aid-veterans-funeral-deceased', code: 'VETERANS_FUNERAL_DECEASED', programId: 'program-veterans', shortName: 'Допомога на поховання сім’ї померлого', officialName: 'Одноразова матеріальна допомога на поховання, сім’ям померлих військовослужбовців, які брали безпосередню участь у бойових діях з оборони України, захист її суверенітету, територіальної цілісності та недоторканості в період режиму воєнного стану' },
  { id: 'aid-veterans-release', code: 'VETERANS_RELEASE', programId: 'program-veterans', shortName: 'Допомога після звільнення з полону', officialName: 'Одноразова матеріальна допомога військовослужбовцям Сил безпеки і оборони України, стосовно яких встановлено факт позбавлення особистої свободи внаслідок збройної агресії проти України, в разі звільнення з полону' },
  { id: 'aid-veterans-missing-family', code: 'VETERANS_MISSING_FAMILY', programId: 'program-veterans', shortName: 'Допомога сім’ям зниклих безвісти', officialName: 'Щорічна одноразова матеріальна допомога членам сімей військовослужбовців, стосовно яких встановлено факт зниклих безвісти' },
]

export function openAppDatabase(userDataPath: string): DatabaseSync {
  mkdirSync(userDataPath, { recursive: true })
  return openInitializedDatabase(join(userDataPath, 'hromada-aid.sqlite'))
}

/**
 * Opens an explicitly selected SQLite database using the complete HromadaAID
 * validation, migration and reference-data initialization flow. Callers own
 * choosing and creating the parent directory; this function never selects a
 * profile path or copies data between databases.
 */
export function openInitializedDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath)
  try {
    // These settings affect the connection, not the database's schema or journal mode.
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;')
    database.exec('BEGIN IMMEDIATE')
    try {
      // Keep validation and migrations under the same write lock: another connection
      // cannot change the schema between checking its version and applying migrations.
      checkDatabaseIntegrity(database)
      const currentVersion = readSupportedSchemaVersion(database)
      checkForeignKeys(database)
      migrate(database, currentVersion)
      if (currentVersion === 0) seedReferenceData(database)
      checkForeignKeys(database)
      database.exec('COMMIT')
    } catch (error) {
      try { database.exec('ROLLBACK') } catch { /* Preserve the initialization error. */ }
      throw error
    }
    // journal_mode is persistent and cannot be changed inside the transaction.
    // Do not touch it before a database has passed the compatibility checks.
    database.exec('PRAGMA journal_mode = WAL;')
    return database
  } catch (error) {
    try { database.close() } catch { /* Preserve the original initialization error. */ }
    // Corrupt files can fail even at BEGIN or while reading PRAGMA results.
    // Extended SQLite result codes retain the primary code in their low byte.
    const sqliteCode = error instanceof Error && 'errcode' in error && typeof error.errcode === 'number'
      ? error.errcode & 0xff : undefined
    if (sqliteCode === 11 || sqliteCode === 26) throw new DatabaseIntegrityError('corruption')
    throw error
  }
}

function readSupportedSchemaVersion(database: DatabaseSync): number {
  const currentVersion = Number((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  if (currentVersion > maximumSupportedSchemaVersion) {
    throw new DatabaseSchemaError(`База даних має версію схеми ${currentVersion}, а ця версія HromadaAID підтримує до ${maximumSupportedSchemaVersion}. Використайте новішу версію HromadaAID. Міграції та зміни даних не виконувалися.`)
  }
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new DatabaseSchemaError('Некоректне значення версії схеми бази даних. Відкриття зупинено без автоматичного виправлення.')
  }
  const hasHistory = database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migrations'").get()
  if (!hasHistory) {
    const hasSchema = database.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()
    if (currentVersion === 0 && !hasSchema) return 0
    throw new DatabaseSchemaError(`Версія схеми — ${currentVersion}, але таблиця schema_migrations відсутня. Це може бути база старого формату або порушення її структури. Потрібна перевірка сумісності; автоматичне відновлення журналу не виконувалося.`)
  }
  let recordedVersions: number[]
  try {
    recordedVersions = (database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(({ version }) => version)
  } catch {
    throw new DatabaseSchemaError('Не вдалося прочитати журнал schema_migrations. Потрібна перевірка формату та сумісності бази; автоматичне виправлення не виконувалося.')
  }
  // All supported historical schemas have recorded every migration starting at 1.
  // An empty version-0 database must have no application schema, including this table.
  const expectedVersions = migrations.filter(({ version }) => version <= currentVersion).map(({ version }) => version)
  if (currentVersion === 0 || recordedVersions.length !== expectedVersions.length || recordedVersions.some((version, index) => version !== expectedVersions[index])) {
    throw new DatabaseSchemaError(`PRAGMA user_version (${currentVersion}) не узгоджується з журналом schema_migrations. Відкриття зупинено. Для старої бази потрібна перевірка її формату; версію та журнал автоматично не змінено.`)
  }
  return currentVersion
}

function migrate(database: DatabaseSync, currentVersion: number) {
  // The caller holds the transaction for validation, the complete migration chain,
  // and (only for a new database) reference initialization.
  for (const migration of migrations.filter(({ version }) => version > currentVersion)) {
    if (migration.version === 15) migrateAssignmentStatuses(database)
    if (migration.version === 16) {
      try { migrateBanks(database) }
      catch (error) { if (error instanceof BankMigrationError) throw new DatabaseSchemaError(error.message); throw error }
    }
    if (migration.version === 17) migrateAddresses(database)
    database.exec(migration.sql)
    database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString())
    database.exec(`PRAGMA user_version = ${migration.version}`)
  }
}

function seedReferenceData(database: DatabaseSync) {
  // Called only inside the new database's initialization transaction.
  const now = new Date().toISOString()
  const addProgram = database.prepare('INSERT INTO programs(id, code, short_name, official_name, updated_at) VALUES (?, ?, ?, ?, ?)')
  for (const program of programs) addProgram.run(program.id, program.code, program.shortName, program.officialName, now)

  const addAidType = database.prepare('INSERT INTO aid_types(id, code, program_id, short_name, official_name, direction, funding_source, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const aidType of aidTypes) addAidType.run(
    aidType.id,
    aidType.code,
    aidType.programId,
    aidType.shortName,
    aidType.officialName,
    ('direction' in aidType ? aidType.direction : null) ?? null,
    ('fundingSource' in aidType ? aidType.fundingSource : null) ?? null,
    ('isActive' in aidType ? (aidType.isActive ? 1 : 0) : 1),
    now,
  )
  database.exec(`
    WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY short_name,id)-1 AS position FROM programs)
      UPDATE programs SET sort_order=(SELECT position FROM ordered WHERE ordered.id=programs.id);
    WITH ordered AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY program_id ORDER BY short_name,id)-1 AS position FROM aid_types)
      UPDATE aid_types SET sort_order=(SELECT position FROM ordered WHERE ordered.id=aid_types.id);
  `)
  database.prepare("INSERT OR IGNORE INTO catalog_order_revisions(scope,revision) VALUES ('programs',?)").run(now)
  for (const program of programs) database.prepare('INSERT OR IGNORE INTO catalog_order_revisions(scope,revision) VALUES (?,?)').run(`aid-types:${program.id}`, now)

}
