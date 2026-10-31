/**
 * Read-only health check for the real desktop workspace.
 *
 * The browser preview uses localStorage, but the Tauri shell opens
 * app_data_dir()/civicflow.db through civicflow-core. This script inspects that
 * file after the desktop app has run and refuses a database that is missing,
 * foreign, corrupt, on the wrong schema, or missing a required table.
 *
 * Usage:
 *   pnpm db:verify
 *   pnpm db:verify --path "/path/to/civicflow.db"
 *   CIVICFLOW_DB=/path/to/civicflow.db pnpm db:verify
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const pathFlag = args.indexOf("--path");
const explicit =
  (pathFlag >= 0 ? args[pathFlag + 1] : undefined) ?? process.env.CIVICFLOW_DB ?? undefined;

const candidates = [
  explicit,
  path.join(
    homedir(),
    "Library",
    "Application Support",
    "io.github.praket7.civicflow",
    "civicflow.db",
  ),
  path.join(homedir(), ".local", "share", "io.github.praket7.civicflow", "civicflow.db"),
  process.env.APPDATA
    ? path.join(process.env.APPDATA, "io.github.praket7.civicflow", "civicflow.db")
    : undefined,
].filter(Boolean);

const dbPath = candidates.find((candidate) => existsSync(candidate));

if (!dbPath) {
  console.error("No CivicFlow desktop database found. Open the Tauri app once, then retry.");
  console.error("Searched:");
  for (const candidate of candidates) console.error(`  ${candidate}`);
  process.exit(1);
}

const requiredTables = [
  "schema_migrations",
  "organizations",
  "organization_contacts",
  "organization_memberships",
  "organization_invites",
  "organization_updates",
  "organization_update_reads",
  "app_settings",
  "users",
  "auth_sessions",
  "auth_attempts",
  "volunteers",
  "volunteer_skills",
  "availability_rules",
  "credential_types",
  "volunteer_credentials",
  "opportunities",
  "shifts",
  "shift_roles",
  "role_requirements",
  "saved_opportunities",
  "applications",
  "volunteer_stage_history",
  "registrations",
  "waitlist_entries",
  "attendance_events",
  "attendance_ledger",
  "checkin_codes",
  "hour_entries",
  "service_verifications",
  "impact_totals",
  "impact_metric_definitions",
  "impact_results",
  "notifications",
  "activity_events",
  "audit_events",
  "report_saved_views",
  "backup_snapshots",
  "organization_roster_policies",
  "shift_series",
  "shift_series_roles",
  "notification_rules",
];

// Keep in step with SCHEMA_VERSION in src-tauri/core/src/db.rs.
const expectedSchemaVersion = 11;
const db = new DatabaseSync(dbPath, { readOnly: true });

try {
  const one = (sql) => db.prepare(sql).get();
  const all = (sql) => db.prepare(sql).all();

  const integrity = one("PRAGMA integrity_check").integrity_check;
  const schemaVersion = one("PRAGMA user_version").user_version;
  const foreignKeys = all("PRAGMA foreign_key_check");
  const tables = new Set(
    all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name),
  );
  const migrations = one("SELECT COUNT(*) AS count FROM schema_migrations").count;
  const requiredMissing = requiredTables.filter((table) => !tables.has(table));

  const counts = {
    volunteers: one("SELECT COUNT(*) AS count FROM volunteers").count,
    opportunities: one("SELECT COUNT(*) AS count FROM opportunities").count,
    shifts: one("SELECT COUNT(*) AS count FROM shifts").count,
    registrations: one("SELECT COUNT(*) AS count FROM registrations").count,
    hourEntries: one("SELECT COUNT(*) AS count FROM hour_entries").count,
    auditEvents: one("SELECT COUNT(*) AS count FROM audit_events").count,
    backups: one("SELECT COUNT(*) AS count FROM backup_snapshots").count,
  };

  const failures = [];
  if (integrity !== "ok") failures.push(`integrity check: ${integrity}`);
  if (schemaVersion !== expectedSchemaVersion) {
    failures.push(`schema version ${schemaVersion}, expected ${expectedSchemaVersion}`);
  }
  if (foreignKeys.length > 0) failures.push(`${foreignKeys.length} foreign-key violations`);
  if (requiredMissing.length > 0) failures.push(`missing tables: ${requiredMissing.join(", ")}`);
  if (migrations !== expectedSchemaVersion) {
    failures.push(`${migrations} migration rows, expected ${expectedSchemaVersion}`);
  }
  if (counts.volunteers === 0 || counts.shifts === 0) {
    failures.push("workspace looks unseeded (no volunteers or shifts)");
  }

  const size = statSync(dbPath).size;
  console.log("CivicFlow database");
  console.log(`  path            ${dbPath}`);
  console.log(`  size            ${(size / 1024).toFixed(1)} KiB`);
  console.log(`  integrity       ${integrity}`);
  console.log(`  schema          v${schemaVersion} (${migrations} migrations)`);
  console.log(
    `  foreign keys    ${foreignKeys.length === 0 ? "ok" : `${foreignKeys.length} violations`}`,
  );
  console.log(
    `  tables          ${requiredTables.length - requiredMissing.length}/${requiredTables.length}`,
  );
  console.log("  records");
  for (const [name, value] of Object.entries(counts)) {
    console.log(`    ${name.padEnd(14)} ${value}`);
  }

  if (failures.length > 0) {
    console.error("\nDatabase verification failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log("\nDatabase verification passed.");
} finally {
  db.close();
}
