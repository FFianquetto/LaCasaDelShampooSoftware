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

function tableHasColumn(db: Db, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
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
      if (migration.id === 2 && tableHasColumn(db, "products", "brand")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }
      if (migration.id === 3 && tableHasColumn(db, "products", "category")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }
      if (migration.id === 4 && tableHasColumn(db, "products", "code")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }

      if (migration.id === 5 && tableHasColumn(db, "customers", "store_id")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }

      if (
        migration.id === 6 &&
        tableHasColumn(db, "inventory_marks", "product_id")
      ) {
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
  assignProductCodes(db);
}

function assignProductCodes(db: Db): void {
  if (!tableHasColumn(db, "products", "code")) return;
  const missing = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM products WHERE code IS NULL OR code = ''",
      )
      .get() as { c: number }
  ).c;
  if (missing === 0) return;

  const rows = db
    .prepare(
      "SELECT id FROM products ORDER BY brand COLLATE NOCASE, name COLLATE NOCASE",
    )
    .all() as { id: string }[];
  const update = db.prepare("UPDATE products SET code = ? WHERE id = ?");
  const tx = db.transaction(() => {
    rows.forEach((row, index) => {
      update.run(`P${String(index + 1).padStart(4, "0")}`, row.id);
    });
  });
  tx();
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
