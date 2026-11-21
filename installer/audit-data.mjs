import XLSX from "xlsx";
import Database from "better-sqlite3";
import path from "node:path";

function cell(row, name) {
  const key = Object.keys(row).find((k) => k.trim() === name);
  return key ? row[key] : null;
}

const wb = XLSX.readFile("Base de datos.xlsx");
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Hoja1, { defval: null });
const unique = new Map();
for (const r of rows) {
  const name = cell(r, "PRODUCTO");
  if (!name || String(name).trim() === "") continue;
  const brand = String(cell(r, "MARCA") ?? "").trim() || "SIN MARCA";
  const producto = String(name).trim();
  const key = `${brand.toLowerCase()}|${producto.toLowerCase()}`;
  if (unique.has(key)) continue;
  unique.set(key, {
    id: cell(r, "ID"),
    barcode: cell(r, "CÓDIGO DE BARRA") ?? cell(r, "CODIGO DE BARRA"),
    marca: brand,
    producto,
    costo: cell(r, "COSTO"),
    publico: cell(r, "PRECIO PUBLICO"),
    distribuidor: cell(r, "PRECIO DISTRIBUIDOR"),
    foraneo: cell(r, "PRECIO FORANEO"),
    reparto: cell(r, "PRECIO REPARTO"),
  });
}

const sinCosto = [...unique.values()].filter(
  (p) => p.costo == null || p.costo === "" || Number(p.costo) === 0,
);
console.log("Excel productos:", unique.size);
console.log("Excel sin costo / cero:", sinCosto.length);
sinCosto.forEach((p) =>
  console.log(" ", p.id, p.marca, p.producto, "costo=", p.costo),
);

const db = new Database(path.resolve("data/lacasadelshampoo.db"));
const dups = db
  .prepare(
    `SELECT lower(name) n, lower(ifnull(brand,'')) b, count(*) c
     FROM products GROUP BY 1,2 HAVING c>1`,
  )
  .all();
console.log("Duplicados name+brand:", dups);

const noCost = db
  .prepare(
    "SELECT code, brand, name, cost FROM products WHERE cost IS NULL OR cost = 0 ORDER BY code",
  )
  .all();
console.log("BD sin costo:", noCost.length);
noCost.forEach((p) => console.log(" ", p.code, p.brand, p.name, p.cost));

const saleCosts = db
  .prepare(
    "SELECT COUNT(*) AS c, SUM(CASE WHEN unit_cost IS NULL THEN 1 ELSE 0 END) AS nulls FROM sale_items",
  )
  .get();
console.log("sale_items:", saleCosts);

let costMismatch = 0;
const costSample = [];
let priceMismatch = 0;
const priceSample = [];
let missingCode = 0;

for (const p of unique.values()) {
  const key = `${p.marca.toLowerCase()}|${p.producto.toLowerCase()}`;
  const row = db
    .prepare(
      `SELECT id, code, cost FROM products
       WHERE lower(name)=? AND lower(ifnull(brand,''))=?`,
    )
    .get(p.producto.toLowerCase(), p.marca.toLowerCase());
  if (!row) {
    missingCode++;
    continue;
  }
  const excelCost =
    p.costo == null || p.costo === "" ? null : Number(p.costo);
  if (
    excelCost != null &&
    Number.isFinite(excelCost) &&
    Number(row.cost) !== excelCost
  ) {
    costMismatch++;
    if (costSample.length < 8) {
      costSample.push({
        code: row.code,
        name: p.producto,
        excel: excelCost,
        db: row.cost,
      });
    }
  }
  for (const [cat, excel] of [
    ["Publico", p.publico],
    ["Distribuidor", p.distribuidor],
    ["Foraneo", p.foraneo],
    ["Reparto", p.reparto],
  ]) {
    if (excel == null || excel === "") continue;
    const pr = db
      .prepare(
        `SELECT price FROM price_list
         WHERE product_id=? AND customer_category=? AND sale_type='Menudeo'`,
      )
      .get(row.id, cat);
    if (!pr || Number(pr.price) !== Number(excel)) {
      priceMismatch++;
      if (priceSample.length < 8) {
        priceSample.push({
          code: row.code,
          name: p.producto,
          cat,
          excel: Number(excel),
          db: pr?.price ?? null,
        });
      }
    }
  }
}

console.log("No encontrados en BD:", missingCode);
console.log("Costos distintos:", costMismatch, costSample);
console.log("Precios distintos:", priceMismatch, priceSample);

const idDup = db
  .prepare(
    `SELECT code, count(*) c FROM products
     WHERE code IS NOT NULL GROUP BY code HAVING c>1`,
  )
  .all();
console.log("Códigos duplicados:", idDup);

db.close();
