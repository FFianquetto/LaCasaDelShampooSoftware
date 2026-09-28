import XLSX from "xlsx";
import Database from "better-sqlite3";

const db = new Database("data/lacasadelshampoo.db");
const cols = db.prepare("PRAGMA table_info(products)").all();
if (!cols.some((col) => col.name === "code")) {
  db.exec("ALTER TABLE products ADD COLUMN code TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code ON products(code)");
}

const missing = db
  .prepare("SELECT COUNT(*) AS c FROM products WHERE code IS NULL OR code = ''")
  .get().c;
if (missing > 0) {
  const rows = db
    .prepare(
      "SELECT id FROM products ORDER BY brand COLLATE NOCASE, name COLLATE NOCASE",
    )
    .all();
  const update = db.prepare("UPDATE products SET code = ? WHERE id = ?");
  const tx = db.transaction(() => {
    rows.forEach((row, index) => {
      update.run(`P${String(index + 1).padStart(4, "0")}`, row.id);
    });
  });
  tx();
}

function cell(row, name) {
  const key = Object.keys(row).find((item) => item.trim() === name);
  return key ? row[key] : null;
}

const excelRows = XLSX.utils.sheet_to_json(
  XLSX.readFile("Base de datos.xlsx").Sheets.Hoja1,
  { defval: null },
);
const excel = new Map();
for (const row of excelRows) {
  const name = cell(row, "PRODUCTO");
  if (!name || String(name).trim() === "") continue;
  const brand = String(cell(row, "MARCA") ?? "").trim() || "SIN MARCA";
  const key = `${brand.toLowerCase()}|${String(name).trim().toLowerCase()}`;
  if (!excel.has(key)) {
    excel.set(key, {
      brand,
      name: String(name).trim(),
      publico: cell(row, "PRECIO PUBLICO"),
      distribuidor: cell(row, "PRECIO DISTRIBUIDOR"),
      foraneo: cell(row, "PRECIO FORANEO"),
      reparto: cell(row, "PRECIO REPARTO"),
    });
  }
}

const dbRows = db
  .prepare("SELECT id, code, name, brand FROM products")
  .all();
const dbMap = new Map(
  dbRows.map((row) => [
    `${String(row.brand ?? "").toLowerCase()}|${String(row.name).trim().toLowerCase()}`,
    row,
  ]),
);

const missingInDb = [];
for (const [key, item] of excel) {
  if (!dbMap.has(key)) missingInDb.push(`${item.brand} / ${item.name}`);
}
const extraInDb = [];
for (const [key, row] of dbMap) {
  if (!excel.has(key)) extraInDb.push(`${row.code} ${row.brand} / ${row.name}`);
}

let priceMismatches = 0;
const sampleMismatch = [];
for (const [key, item] of excel) {
  const product = dbMap.get(key);
  if (!product) continue;
  const prices = db
    .prepare(
      `SELECT customer_category AS cat, price FROM price_list
       WHERE product_id = ? AND sale_type = 'Menudeo'`,
    )
    .all(product.id);
  const byCat = Object.fromEntries(prices.map((price) => [price.cat, price.price]));
  const checks = [
    ["Publico", item.publico],
    ["Distribuidor", item.distribuidor],
    ["Foraneo", item.foraneo],
    ["Reparto", item.reparto],
  ];
  for (const [cat, expected] of checks) {
    if (expected == null || expected === "") continue;
    if (Number(byCat[cat]) !== Number(expected)) {
      priceMismatches += 1;
      if (sampleMismatch.length < 5) {
        sampleMismatch.push({
          code: product.code,
          name: item.name,
          cat,
          excel: Number(expected),
          db: byCat[cat] ?? null,
        });
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      excelProductos: excel.size,
      dbProductos: dbRows.length,
      conId: db.prepare("SELECT COUNT(*) AS c FROM products WHERE code IS NOT NULL").get().c,
      faltanEnBd: missingInDb.length,
      sobranEnBd: extraInDb.length,
      preciosDistintos: priceMismatches,
      muestraPrecios: sampleMismatch,
      primerosIds: db
        .prepare("SELECT code, brand, name FROM products ORDER BY code LIMIT 5")
        .all(),
    },
    null,
    2,
  ),
);
db.close();
