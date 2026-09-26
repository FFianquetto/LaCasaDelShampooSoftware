import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations.js";

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

function productHasColumn(db: Db, column: string): boolean {
  const cols = db.prepare("PRAGMA table_info(products)").all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (
      db
        .prepare("SELECT id FROM schema_migrations")
        .all() as { id: number }[]
    ).map((r) => r.id),
  );

  const run = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;

      // BD nueva ya con schema actualizado: saltar migraciones de columnas
      if (migration.id === 2 && productHasColumn(db, "brand")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }
      if (migration.id === 3 && productHasColumn(db, "category")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }

      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
      ).run(migration.id, migration.name);
    }
  });

  run();
}

export function getMeta(db: Db, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
