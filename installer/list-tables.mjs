import Database from "better-sqlite3";

const db = new Database("data/lacasadelshampoo.db", { readonly: true });
console.table(
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all(),
);
db.close();
