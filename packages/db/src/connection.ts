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

      if (migration.id === 8 && tableHasColumn(db, "customers", "client_number")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }

      if (migration.id === 13 && tableHasColumn(db, "sales", "ticket_phone")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }

      if (migration.id === 12 && tableHasColumn(db, "users", "phone")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }

      if (migration.id === 11 && tableHasColumn(db, "customers", "email")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }

      if (migration.id === 10 && tableHasColumn(db, "sales", "ticket_email")) {
        db.prepare(
          "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
        ).run(migration.id, migration.name);
        continue;
      }

      if (migration.id === 9 && tableHasColumn(db, "products", "barcode")) {
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
  syncProductBarcodes(db);
  assignDistributorDefaults(db);
}

const PRODUCT_CODE_SCHEME = "category-brand-name-v1";

function formatProductCode(index: number): string {
  return `P${String(index).padStart(4, "0")}`;
}

function nextProductCodeNumber(db: Db): number {
  const rows = db
    .prepare("SELECT code FROM products WHERE code GLOB 'P[0-9]*'")
    .all() as { code: string }[];
  let max = 0;
  for (const row of rows) {
    const value = Number(row.code.slice(1));
    if (Number.isInteger(value)) max = Math.max(max, value);
  }
  return max + 1;
}

function assignProductCodes(db: Db): void {
  if (!tableHasColumn(db, "products", "code")) return;
  const order = `
    ORDER BY IFNULL(category, 'Otros') COLLATE NOCASE,
             IFNULL(brand, '') COLLATE NOCASE,
             name COLLATE NOCASE,
             id
  `;

  if (getMeta(db, "product_code_scheme") !== PRODUCT_CODE_SCHEME) {
    const rows = db
      .prepare(`SELECT id FROM products ${order}`)
      .all() as { id: string }[];
    const update = db.prepare("UPDATE products SET code = ? WHERE id = ?");
    const tx = db.transaction(() => {
      rows.forEach((row, index) => {
        update.run(`TMP${String(index + 1).padStart(6, "0")}`, row.id);
      });
      rows.forEach((row, index) => {
        update.run(formatProductCode(index + 1), row.id);
      });
    });
    tx();
    setMeta(db, "product_code_scheme", PRODUCT_CODE_SCHEME);
    return;
  }

  const missing = db
    .prepare(
      `SELECT id FROM products
       WHERE code IS NULL OR code = ''
       ${order}`,
    )
    .all() as { id: string }[];
  if (missing.length === 0) return;

  let next = nextProductCodeNumber(db);
  const update = db.prepare("UPDATE products SET code = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const row of missing) {
      update.run(formatProductCode(next), row.id);
      next += 1;
    }
  });
  tx();
}

function syncProductBarcodes(db: Db): void {
  if (!tableHasColumn(db, "products", "barcode")) return;
  if (!tableHasColumn(db, "products", "code")) return;
  db.prepare(
    `UPDATE products
     SET barcode = code
     WHERE code IS NOT NULL AND code != ''
       AND (barcode IS NULL OR barcode = '')`,
  ).run();
}

function assignDistributorDefaults(db: Db): void {
  if (!tableHasColumn(db, "customers", "client_number")) return;
  if (!tableHasColumn(db, "customers", "purchase_every_days")) return;

  db.prepare(
    `UPDATE customers
     SET purchase_every_days = 30
     WHERE category IN ('Distribuidor', 'Foraneo')
       AND purchase_every_days IS NULL`,
  ).run();

  const missing = db
    .prepare(
      `SELECT id FROM customers
       WHERE category IN ('Distribuidor', 'Foraneo')
         AND (client_number IS NULL OR client_number = '')
       ORDER BY created_at, name`,
    )
    .all() as { id: string }[];
  if (missing.length === 0) return;

  const existing = db
    .prepare(
      `SELECT client_number FROM customers
       WHERE client_number GLOB 'D-[0-9]*'`,
    )
    .all() as { client_number: string }[];
  let max = 0;
  for (const row of existing) {
    const value = Number(row.client_number.slice(2));
    if (Number.isInteger(value)) max = Math.max(max, value);
  }

  const update = db.prepare(
    "UPDATE customers SET client_number = ? WHERE id = ?",
  );
  const tx = db.transaction(() => {
    for (const row of missing) {
      max += 1;
      update.run(`D-${String(max).padStart(4, "0")}`, row.id);
    }
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
