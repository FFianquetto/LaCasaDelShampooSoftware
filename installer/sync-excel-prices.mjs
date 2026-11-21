/**
 * Restaura costos y precios de venta desde Base de datos.xlsx
 * y rellena sale_items.unit_cost faltantes con products.cost.
 */
import XLSX from "xlsx";
import Database from "better-sqlite3";
import path from "node:path";
import { randomUUID } from "node:crypto";

function cell(row, name) {
  const key = Object.keys(row).find((k) => k.trim() === name);
  return key ? row[key] : null;
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

const db = new Database(path.resolve("data/lacasadelshampoo.db"));
const excelRows = XLSX.utils.sheet_to_json(
  XLSX.readFile("Base de datos.xlsx").Sheets.Hoja1,
  { defval: null },
);

const unique = new Map();
for (const row of excelRows) {
  const name = cell(row, "PRODUCTO");
  if (!name || String(name).trim() === "") continue;
  const brand = String(cell(row, "MARCA") ?? "").trim() || "SIN MARCA";
  const producto = String(name).trim();
  const key = `${brand.toLowerCase()}|${producto.toLowerCase()}`;
  if (unique.has(key)) continue;
  unique.set(key, {
    code: cell(row, "ID") == null ? null : String(cell(row, "ID")).trim(),
    barcode: (() => {
      const raw = cell(row, "CÓDIGO DE BARRA") ?? cell(row, "CODIGO DE BARRA");
      return raw == null ? null : String(raw).trim();
    })(),
    brand,
    name: producto,
    costo: num(cell(row, "COSTO")),
    publico: num(cell(row, "PRECIO PUBLICO")),
    distribuidor: num(cell(row, "PRECIO DISTRIBUIDOR")),
    foraneo: num(cell(row, "PRECIO FORANEO")),
    reparto: num(cell(row, "PRECIO REPARTO")),
  });
}

const findProduct = db.prepare(
  `SELECT id, code, cost FROM products
   WHERE lower(name) = ? AND lower(ifnull(brand,'')) = ?`,
);
const updateProduct = db.prepare(
  `UPDATE products SET cost = ?, code = COALESCE(?, code), barcode = COALESCE(?, barcode)
   WHERE id = ?`,
);
const findPrice = db.prepare(
  `SELECT id, price FROM price_list
   WHERE product_id = ? AND customer_category = ? AND sale_type = ?`,
);
const updatePrice = db.prepare(`UPDATE price_list SET price = ? WHERE id = ?`);
const insertPrice = db.prepare(
  `INSERT INTO price_list (id, product_id, customer_category, sale_type, price)
   VALUES (?, ?, ?, ?, ?)`,
);

let costsUpdated = 0;
let pricesUpdated = 0;
let pricesCreated = 0;
let codesSet = 0;
const missingCost = [];

const tx = db.transaction(() => {
  for (const item of unique.values()) {
    const product = findProduct.get(item.name.toLowerCase(), item.brand.toLowerCase());
    if (!product) continue;

    if (item.costo != null || product.cost != null) {
      if (Number(product.cost) !== Number(item.costo ?? null)) {
        updateProduct.run(item.costo, item.code, item.barcode, product.id);
        costsUpdated++;
      } else if (item.code || item.barcode) {
        updateProduct.run(product.cost, item.code, item.barcode, product.id);
        if (item.code) codesSet++;
      }
    } else {
      missingCost.push(`${item.code ?? "?"} ${item.brand} / ${item.name}`);
      if (item.code || item.barcode) {
        updateProduct.run(null, item.code, item.barcode, product.id);
      }
    }

    for (const [cat, price] of [
      ["Publico", item.publico],
      ["Distribuidor", item.distribuidor],
      ["Foraneo", item.foraneo],
      ["Reparto", item.reparto],
    ]) {
      if (price == null) continue;
      for (const saleType of ["Menudeo", "Mayoreo"]) {
        const existing = findPrice.get(product.id, cat, saleType);
        if (existing) {
          if (Number(existing.price) !== price) {
            updatePrice.run(price, existing.id);
            pricesUpdated++;
          }
        } else {
          insertPrice.run(newId("prc"), product.id, cat, saleType, price);
          pricesCreated++;
        }
      }
    }
  }

  const backfill = db
    .prepare(
      `UPDATE sale_items
       SET unit_cost = (
         SELECT p.cost FROM products p WHERE p.id = sale_items.product_id
       )
       WHERE unit_cost IS NULL
         AND EXISTS (
           SELECT 1 FROM products p
           WHERE p.id = sale_items.product_id AND p.cost IS NOT NULL
         )`,
    )
    .run();
  console.log("sale_items unit_cost rellenados:", backfill.changes);
});

tx();

console.log(
  JSON.stringify(
    {
      costsUpdated,
      pricesUpdated,
      pricesCreated,
      codesSet,
      missingCostInExcel: missingCost,
    },
    null,
    2,
  ),
);
db.close();
