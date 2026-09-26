import { openDatabase, migrate, type Db } from "@lcds/db";
import { config } from "./config.js";

let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    db = openDatabase(config.dbPath);
    migrate(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
