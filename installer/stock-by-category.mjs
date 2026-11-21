import Database from "better-sqlite3";

const db = new Database("data/lacasadelshampoo.db", { readonly: true });
const byCat = db
  .prepare(
    `SELECT IFNULL(p.category,'Otros') AS category,
            COUNT(DISTINCT p.id) AS products,
            COALESCE(SUM(CASE WHEN l.status='Disponible' THEN 1 ELSE 0 END),0) AS disponible,
            ROUND(1.0*COALESCE(SUM(CASE WHEN l.status='Disponible' THEN 1 ELSE 0 END),0)/COUNT(DISTINCT p.id),1) AS avg_per_product
     FROM products p
     LEFT JOIN lots l ON l.product_id=p.id
     WHERE p.active=1
     GROUP BY 1 ORDER BY category`,
  )
  .all();
console.log("Por categoria:");
console.table(byCat);

const dist = db
  .prepare(
    `WITH stock AS (
       SELECT p.id, IFNULL(p.category,'Otros') AS category,
              COALESCE(SUM(CASE WHEN l.status='Disponible' THEN 1 ELSE 0 END),0) AS disponible
       FROM products p
       LEFT JOIN lots l ON l.product_id=p.id
       WHERE p.active=1
       GROUP BY p.id
     )
     SELECT category,
            SUM(CASE WHEN disponible=0 THEN 1 ELSE 0 END) AS cero,
            SUM(CASE WHEN disponible BETWEEN 1 AND 2 THEN 1 ELSE 0 END) AS d1_2,
            SUM(CASE WHEN disponible BETWEEN 3 AND 5 THEN 1 ELSE 0 END) AS d3_5,
            SUM(CASE WHEN disponible BETWEEN 6 AND 10 THEN 1 ELSE 0 END) AS d6_10,
            SUM(CASE WHEN disponible > 10 THEN 1 ELSE 0 END) AS d10p
     FROM stock GROUP BY category ORDER BY category`,
  )
  .all();
console.log("Distribucion por producto:");
console.table(dist);

const brands = db
  .prepare(
    `SELECT IFNULL(brand,'SIN') b, COUNT(*) c FROM products WHERE active=1 GROUP BY 1 ORDER BY c DESC`,
  )
  .all();
console.log("Marcas:");
console.table(brands);
db.close();
