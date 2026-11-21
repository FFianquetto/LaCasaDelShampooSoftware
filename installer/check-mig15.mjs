import Database from "better-sqlite3";
import path from "node:path";

// Trigger migrate via server getDb would be better; open and check after server restart.
// Here we just inspect current DB; migration runs when server starts.
const db = new Database(path.resolve("data/lacasadelshampoo.db"));
console.log(
  "table:",
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='price_cost_history'",
    )
    .get(),
);
console.log(
  "mig15:",
  db.prepare("SELECT id, name FROM schema_migrations WHERE id = 15").get(),
);
db.close();
