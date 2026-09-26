import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { newId, nowIso, setMeta } from "@lcds/db";
import {
  CustomerCategory,
  SaleType,
  STORE_SEED,
  classifyProductCategory,
  type CustomerCategory as Cat,
} from "@lcds/shared";
import { getDb, closeDb } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");

function cell(row: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(row).find((k) => k.trim() === name);
  return key ? row[key] : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function slugSku(brand: string, name: string, index: number): string {
  const base = `${brand}-${name}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "PROD"}-${String(index).padStart(4, "0")}`;
}

function ensureStores(db: ReturnType<typeof getDb>) {
  const byCode = new Map(
    (
      db.prepare("SELECT * FROM stores").all() as Record<string, unknown>[]
    ).map((r) => [String(r.code), r]),
  );

  for (const seed of STORE_SEED) {
    const existing = byCode.get(seed.code);
    if (existing) {
      db.prepare("UPDATE stores SET name = ? WHERE id = ?").run(
        seed.name,
        existing.id,
      );
    } else {
      // migrate old T1/T2/T3 codes if present
      const oldCodes = ["T1", "T2", "T3"];
      const idx = STORE_SEED.findIndex((s) => s.code === seed.code);
      const old = oldCodes[idx]
        ? byCode.get(oldCodes[idx])
        : undefined;
      if (old) {
        db.prepare("UPDATE stores SET name = ?, code = ? WHERE id = ?").run(
          seed.name,
          seed.code,
          old.id,
        );
        byCode.delete(oldCodes[idx]);
        byCode.set(seed.code, { ...old, code: seed.code, name: seed.name });
      } else {
        const id = newId("str");
        db.prepare(
          `INSERT INTO stores (id, name, code, created_at) VALUES (?, ?, ?, ?)`,
        ).run(id, seed.name, seed.code, nowIso());
      }
    }
  }
}

function upsertPrice(
  db: ReturnType<typeof getDb>,
  productId: string,
  category: Cat,
  saleType: string,
  price: number,
) {
  const existing = db
    .prepare(
      `SELECT id FROM price_list
       WHERE product_id = ? AND customer_category = ? AND sale_type = ?`,
    )
    .get(productId, category, saleType) as { id: string } | undefined;

  if (existing) {
    db.prepare("UPDATE price_list SET price = ? WHERE id = ?").run(
      price,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO price_list (id, product_id, customer_category, sale_type, price)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(newId("prc"), productId, category, saleType, price);
  }
}

async function main() {
  const excelPath =
    process.env.LCDS_EXCEL ||
    path.join(repoRoot, "Base de datos.xlsx");

  if (!fs.existsSync(excelPath)) {
    throw new Error(`No se encontró Excel: ${excelPath}`);
  }

  const db = getDb();
  ensureStores(db);

  const wb = XLSX.readFile(excelPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const unique = new Map<
    string,
    {
      marca: string;
      producto: string;
      costo: number | null;
      publico: number | null;
      distribuidor: number | null;
      foraneo: number | null;
      reparto: number | null;
    }
  >();

  for (const row of rows) {
    const productoRaw = cell(row, "PRODUCTO");
    if (productoRaw == null || String(productoRaw).trim() === "") continue;
    const marca = String(cell(row, "MARCA") ?? "").trim() || "SIN MARCA";
    const producto = String(productoRaw).trim();
    const key = `${marca.toLowerCase()}|${producto.toLowerCase()}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      marca,
      producto,
      costo: num(cell(row, "COSTO")),
      publico: num(cell(row, "PRECIO PUBLICO")),
      distribuidor: num(cell(row, "PRECIO DISTRIBUIDOR")),
      foraneo: num(cell(row, "PRECIO FORANEO")),
      reparto: num(cell(row, "PRECIO REPARTO")),
    });
  }

  // Quitar productos seed de demo si existen (SKU SH-/AC-/TR-/GEL-)
  db.prepare(
    `DELETE FROM price_list WHERE product_id IN (
       SELECT id FROM products WHERE sku LIKE 'SH-%' OR sku LIKE 'AC-%'
         OR sku LIKE 'TR-%' OR sku LIKE 'GEL-%')`,
  ).run();
  db.prepare(
    `DELETE FROM lots WHERE product_id IN (
       SELECT id FROM products WHERE sku LIKE 'SH-%' OR sku LIKE 'AC-%'
         OR sku LIKE 'TR-%' OR sku LIKE 'GEL-%')`,
  ).run();
  db.prepare(
    `DELETE FROM products WHERE sku LIKE 'SH-%' OR sku LIKE 'AC-%'
       OR sku LIKE 'TR-%' OR sku LIKE 'GEL-%'`,
  ).run();

  let created = 0;
  let updated = 0;
  let prices = 0;
  let index = 1;

  const tx = db.transaction(() => {
    for (const item of unique.values()) {
      const sku = slugSku(item.marca, item.producto, index++);
      const category = classifyProductCategory(item.producto, item.marca);
      let product = db
        .prepare(
          `SELECT id FROM products WHERE name = ? AND IFNULL(brand,'') = ?`,
        )
        .get(item.producto, item.marca) as { id: string } | undefined;

      if (!product) {
        const bySku = db
          .prepare("SELECT id FROM products WHERE sku = ?")
          .get(sku) as { id: string } | undefined;
        product = bySku;
      }

      if (product) {
        db.prepare(
          `UPDATE products SET sku = ?, name = ?, brand = ?, category = ?, cost = ?, active = 1 WHERE id = ?`,
        ).run(
          sku,
          item.producto,
          item.marca,
          category,
          item.costo,
          product.id,
        );
        updated++;
      } else {
        const id = newId("prd");
        db.prepare(
          `INSERT INTO products (id, sku, name, brand, category, cost, description, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?)`,
        ).run(
          id,
          sku,
          item.producto,
          item.marca,
          category,
          item.costo,
          nowIso(),
        );
        product = { id };
        created++;
      }

      const priceMap: [Cat, number | null][] = [
        [CustomerCategory.Publico, item.publico],
        [CustomerCategory.Distribuidor, item.distribuidor],
        [CustomerCategory.Foraneo, item.foraneo],
        [CustomerCategory.Reparto, item.reparto],
      ];

      for (const [cat, price] of priceMap) {
        if (price == null) continue;
        for (const saleType of [SaleType.Menudeo, SaleType.Mayoreo]) {
          upsertPrice(db, product.id, cat, saleType, price);
          prices++;
        }
      }
    }
  });

  tx();

  // 1 lote Disponible por producto en Americas (barcode = SKU-lote demo)
  const storeAme = db
    .prepare("SELECT id FROM stores WHERE code = 'AME'")
    .get() as { id: string } | undefined;
  let lotsCreated = 0;
  if (storeAme) {
    const productos = db
      .prepare("SELECT id, sku FROM products WHERE active = 1 ORDER BY name")
      .all() as { id: string; sku: string }[];
    const insertLot = db.prepare(
      `INSERT INTO lots (id, barcode, product_id, store_id, status, created_at)
       VALUES (?, ?, ?, ?, 'Disponible', ?)`,
    );
    const existsLot = db.prepare(
      "SELECT id FROM lots WHERE barcode = ? OR (product_id = ? AND store_id = ? AND status = 'Disponible')",
    );
    const txLots = db.transaction(() => {
      let n = 0;
      for (const p of productos) {
        const barcode = `LCDS${String(n + 1).padStart(6, "0")}`;
        const exists = existsLot.get(barcode, p.id, storeAme.id);
        if (!exists) {
          insertLot.run(newId("lot"), barcode, p.id, storeAme.id, nowIso());
          lotsCreated++;
        }
        n++;
      }
    });
    txLots();
  }

  setMeta(db, "excel_imported_at", nowIso());
  setMeta(db, "excel_source", excelPath);

  const byCategory = db
    .prepare(
      `SELECT IFNULL(category,'Otros') AS category, COUNT(*) AS c
       FROM products GROUP BY IFNULL(category,'Otros') ORDER BY c DESC`,
    )
    .all();

  const totals = {
    productosUnicosExcel: unique.size,
    created,
    updated,
    priceRows: prices,
    productsInDb: (
      db.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number }
    ).c,
    pricesInDb: (
      db.prepare("SELECT COUNT(*) AS c FROM price_list").get() as { c: number }
    ).c,
    lotsCreadosAhora: lotsCreated,
    lotsDisponibles: (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM lots WHERE status = 'Disponible'",
        )
        .get() as { c: number }
    ).c,
    porCategoria: byCategory,
  };

  console.log("Import Excel OK");
  console.log(JSON.stringify(totals, null, 2));
  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
