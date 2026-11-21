import Database from "better-sqlite3";
import { minStockForCategory } from "@lcds/shared";

const db = new Database("data/lacasadelshampoo.db", { readonly: true });
const rows = db
  .prepare(
    `SELECT p.id, p.code, p.name, IFNULL(p.category,'Otros') AS category,
            COALESCE(SUM(CASE WHEN l.status='Disponible' THEN 1 ELSE 0 END),0) AS disponible
     FROM products p
     LEFT JOIN lots l ON l.product_id=p.id
     WHERE p.active=1
     GROUP BY p.id`,
  )
  .all();

const alerts = rows
  .map((p) => {
    const minimum = minStockForCategory(p.category);
    return { ...p, minimum, below: p.disponible < minimum };
  })
  .filter((p) => p.below);

const byCat = {};
for (const a of alerts) {
  byCat[a.category] = (byCat[a.category] || 0) + 1;
}
console.log("Total alertas:", alerts.length);
console.log("Por categoría:", byCat);
console.log(
  "Ejemplos:",
  alerts.slice(0, 5).map((a) =>
    a.disponible <= 0
      ? `Ya no quedan piezas de «${a.name}» (${a.category}). Mínimo: ${a.minimum}.`
      : `Ya solo quedan ${a.disponible} de «${a.name}» (${a.category}). Mínimo: ${a.minimum}.`,
  ),
);
db.close();
