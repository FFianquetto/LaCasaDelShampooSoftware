import XLSX from "xlsx";
import Database from "better-sqlite3";
import path from "node:path";

const wb = XLSX.readFile("Base de datos.xlsx");
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Hoja1"], { defval: null });

function get(r, name) {
  const key = Object.keys(r).find((k) => k.trim() === name);
  return key ? r[key] : null;
}

const uniqueProducts = new Map();
for (const r of rows) {
  const name = get(r, "PRODUCTO");
  if (!name) continue;
  const brand = String(get(r, "MARCA") || "").trim();
  const producto = String(name).trim();
  const key = `${brand}|${producto}`;
  if (!uniqueProducts.has(key)) {
    uniqueProducts.set(key, {
      marca: brand,
      producto,
      costo: get(r, "COSTO"),
      publico: get(r, "PRECIO PUBLICO"),
      distribuidor: get(r, "PRECIO DISTRIBUIDOR"),
      foraneo: get(r, "PRECIO FORANEO"),
      reparto: get(r, "PRECIO REPARTO"),
    });
  }
}

const stores = [...new Set(rows.map((r) => get(r, "TIENDA")).filter(Boolean))];
const tipos = [...new Set(rows.map((r) => get(r, "TIPO CLIENTE")).filter(Boolean))];
const cobros = [...new Set(rows.map((r) => get(r, "TIPO DE COBRO")).filter(Boolean))];
const marcas = [
  ...new Set([...uniqueProducts.values()].map((p) => p.marca).filter(Boolean)),
].sort();

console.log("Tiendas (valores de ejemplo en Excel):", stores);
console.log("Tipos cliente (ejemplo):", tipos);
console.log("Tipos cobro (ejemplo):", cobros);
console.log("Productos únicos:", uniqueProducts.size);
console.log("Marcas:", marcas.length, "→", marcas.join(", "));

let missingForaneo = 0;
for (const p of uniqueProducts.values()) {
  if (p.foraneo == null) missingForaneo++;
}
console.log("Sin precio foráneo:", missingForaneo);

const byBrand = {};
for (const p of uniqueProducts.values()) {
  byBrand[p.marca] = (byBrand[p.marca] || 0) + 1;
}
console.log("Top marcas:");
Object.entries(byBrand)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .forEach(([m, c]) => console.log(`  ${c}\t${m}`));

const dbPath = path.resolve("data/lacasadelshampoo.db");
const db = new Database(dbPath);
console.log("\nSQLite OK →", dbPath);
for (const t of [
  "stores",
  "users",
  "products",
  "lots",
  "price_list",
  "sales",
]) {
  console.log(
    `  ${t}:`,
    db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c,
  );
}
console.log(
  "  productos seed:",
  db.prepare("SELECT sku, name FROM products").all(),
);
console.log(
  "  lotes disponibles:",
  db
    .prepare(
      "SELECT barcode, status FROM lots WHERE status = ? LIMIT 3",
    )
    .all("Disponible"),
);
db.close();
