import Database from "better-sqlite3";

const db = new Database("data/lacasadelshampoo.db");
console.log("=== Tiendas ===");
console.table(db.prepare("SELECT code, name FROM stores ORDER BY code").all());
console.log(
  "Productos:",
  db.prepare("SELECT COUNT(*) AS c FROM products").get().c,
);
console.log(
  "Precios:",
  db.prepare("SELECT COUNT(*) AS c FROM price_list").get().c,
);
console.log(
  "Lotes disponibles:",
  db
    .prepare("SELECT COUNT(*) AS c FROM lots WHERE status = 'Disponible'")
    .get().c,
);
console.log("=== Por categoría general ===");
console.table(
  db
    .prepare(
      `SELECT IFNULL(category,'Otros') AS category, COUNT(*) AS productos
       FROM products GROUP BY IFNULL(category,'Otros') ORDER BY productos DESC`,
    )
    .all(),
);
console.log("=== Muestra productos ===");
console.table(
  db
    .prepare(
      "SELECT brand, name, cost FROM products ORDER BY brand, name LIMIT 5",
    )
    .all(),
);
console.log("=== Precios de un producto ===");
console.table(
  db
    .prepare(
      `SELECT p.name, pl.customer_category, pl.sale_type, pl.price
       FROM price_list pl
       JOIN products p ON p.id = pl.product_id
       WHERE p.name = 'aceite anti celulitis'`,
    )
    .all(),
);
db.close();
