import fs from "node:fs";
import path from "node:path";
import { boolToInt, type Db } from "@lcds/db";
import {
  catalogSyncPayloadSchema,
  storeReportPayloadSchema,
  type CatalogSyncPayload,
  type StoreReportPayload,
} from "@lcds/shared";
import { nowIso } from "@lcds/db";
import { assertFound } from "../errors.js";
import {
  mapPrice,
  mapProduct,
  mapPromotion,
  mapSale,
  mapSaleItem,
  mapStore,
} from "../mappers.js";
import { config } from "../config.js";

export function exportCatalog(db: Db, sourceStoreId?: string): string {
  const payload: CatalogSyncPayload = {
    version: 1,
    kind: "catalog",
    exportedAt: nowIso(),
    sourceStoreId,
    products: (
      db.prepare("SELECT * FROM products").all() as Record<string, unknown>[]
    ).map(mapProduct),
    prices: (
      db.prepare("SELECT * FROM price_list").all() as Record<string, unknown>[]
    ).map(mapPrice),
    promotions: (
      db.prepare("SELECT * FROM promotions").all() as Record<string, unknown>[]
    ).map(mapPromotion),
  };

  fs.mkdirSync(config.exportsDir, { recursive: true });
  const file = path.join(config.exportsDir, `catalog_${Date.now()}.lcds`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

export function importCatalog(
  db: Db,
  filePath: string,
): { products: number; prices: number; promotions: number } {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const payload = catalogSyncPayloadSchema.parse(raw);

  const tx = db.transaction(() => {
    for (const p of payload.products) {
      db.prepare(
        `INSERT INTO products (id, sku, name, description, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           sku = excluded.sku,
           name = excluded.name,
           description = excluded.description,
           active = excluded.active`,
      ).run(
        p.id,
        p.sku,
        p.name,
        p.description,
        boolToInt(p.active),
        p.createdAt,
      );
    }

    for (const price of payload.prices) {
      const existing = db
        .prepare(
          `SELECT id FROM price_list
           WHERE product_id = ? AND customer_category = ? AND sale_type = ?`,
        )
        .get(price.productId, price.customerCategory, price.saleType) as
        | { id: string }
        | undefined;

      if (existing) {
        db.prepare("UPDATE price_list SET price = ? WHERE id = ?").run(
          price.price,
          existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO price_list (id, product_id, customer_category, sale_type, price)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          price.id,
          price.productId,
          price.customerCategory,
          price.saleType,
          price.price,
        );
      }
    }

    for (const promo of payload.promotions) {
      db.prepare(
        `INSERT INTO promotions
         (id, name, type, active, starts_at, ends_at, percent_off, buy_qty, get_qty, product_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           type = excluded.type,
           active = excluded.active,
           starts_at = excluded.starts_at,
           ends_at = excluded.ends_at,
           percent_off = excluded.percent_off,
           buy_qty = excluded.buy_qty,
           get_qty = excluded.get_qty,
           product_id = excluded.product_id`,
      ).run(
        promo.id,
        promo.name,
        promo.type,
        boolToInt(promo.active),
        promo.startsAt,
        promo.endsAt,
        promo.percentOff,
        promo.buyQty,
        promo.getQty,
        promo.productId,
        promo.createdAt,
      );
    }
  });

  tx();
  return {
    products: payload.products.length,
    prices: payload.prices.length,
    promotions: payload.promotions.length,
  };
}

export function exportStoreReport(
  db: Db,
  storeId: string,
  from: string,
  to: string,
): string {
  const storeRow = assertFound(
    db.prepare("SELECT * FROM stores WHERE id = ?").get(storeId) as
      | Record<string, unknown>
      | undefined,
    "Sucursal no encontrada",
  );
  const store = mapStore(storeRow);

  const salesRows = db
    .prepare(
      `SELECT s.*, u.full_name AS employee_name, c.name AS customer_name
       FROM sales s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.store_id = ? AND s.created_at >= ? AND s.created_at <= ?
       ORDER BY s.created_at`,
    )
    .all(storeId, from, to) as Record<string, unknown>[];

  const sales = salesRows.map((row) => {
    const sale = mapSale(row);
    const items = (
      db
        .prepare("SELECT * FROM sale_items WHERE sale_id = ?")
        .all(sale.id) as Record<string, unknown>[]
    ).map(mapSaleItem);
    return {
      ...sale,
      items,
      employeeName: String(row.employee_name),
      customerName:
        row.customer_name == null ? null : String(row.customer_name),
    };
  });

  const lotsSold = sales.reduce((acc, s) => acc + s.items.length, 0);
  const revenue = sales.reduce((acc, s) => acc + s.total, 0);

  const payload: StoreReportPayload = {
    version: 1,
    kind: "store_report",
    exportedAt: nowIso(),
    store,
    from,
    to,
    sales,
    totals: {
      salesCount: sales.length,
      lotsSold,
      revenue: Math.round(revenue * 100) / 100,
    },
  };

  fs.mkdirSync(config.exportsDir, { recursive: true });
  const file = path.join(
    config.exportsDir,
    `report_${store.code}_${Date.now()}.lcds`,
  );
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

export function consolidateReports(filePaths: string[]): {
  stores: {
    code: string;
    name: string;
    salesCount: number;
    lotsSold: number;
    revenue: number;
  }[];
  grandTotal: { salesCount: number; lotsSold: number; revenue: number };
} {
  const stores: {
    code: string;
    name: string;
    salesCount: number;
    lotsSold: number;
    revenue: number;
  }[] = [];

  for (const filePath of filePaths) {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const payload = storeReportPayloadSchema.parse(raw);
    stores.push({
      code: payload.store.code,
      name: payload.store.name,
      salesCount: payload.totals.salesCount,
      lotsSold: payload.totals.lotsSold,
      revenue: payload.totals.revenue,
    });
  }

  const grandTotal = stores.reduce(
    (acc, s) => ({
      salesCount: acc.salesCount + s.salesCount,
      lotsSold: acc.lotsSold + s.lotsSold,
      revenue: Math.round((acc.revenue + s.revenue) * 100) / 100,
    }),
    { salesCount: 0, lotsSold: 0, revenue: 0 },
  );

  return { stores, grandTotal };
}

export function salesReport(
  db: Db,
  filters: { storeId?: string; from?: string; to?: string },
) {
  const clauses: string[] = ["s.ticket_printed = 1"];
  const params: unknown[] = [];
  if (filters.storeId) {
    clauses.push("s.store_id = ?");
    params.push(filters.storeId);
  }
  if (filters.from) {
    clauses.push("s.created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("s.created_at <= ?");
    params.push(filters.to);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;

  const rows = db
    .prepare(
      `SELECT s.*, u.full_name AS employee_name, st.name AS store_name, st.code AS store_code
       FROM sales s
       JOIN users u ON u.id = s.user_id
       JOIN stores st ON st.id = s.store_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT 1000`,
    )
    .all(...params) as Record<string, unknown>[];

  const salesCount = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM sales s ${where}`)
      .get(...params) as { c: number }
  ).c;
  const revenue = (
    db
      .prepare(`SELECT COALESCE(SUM(total), 0) AS t FROM sales s ${where}`)
      .get(...params) as { t: number }
  ).t;
  const lotsSold = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         ${where}`,
      )
      .get(...params) as { c: number }
  ).c;

  return {
    sales: rows.map((r) => ({
      ...mapSale(r),
      employeeName: String(r.employee_name),
      storeName: String(r.store_name),
      storeCode: String(r.store_code),
    })),
    totals: {
      salesCount,
      lotsSold,
      revenue: Math.round(Number(revenue) * 100) / 100,
    },
  };
}

export function inventorySummary(db: Db, storeId: string) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS c FROM lots WHERE store_id = ? GROUP BY status`,
    )
    .all(storeId) as { status: string; c: number }[];

  const map: Record<string, number> = { Disponible: 0, Vendido: 0 };
  for (const r of rows) map[r.status] = r.c;
  return map;
}
