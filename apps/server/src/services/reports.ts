import fs from "node:fs";
import path from "node:path";
import { boolToInt, type Db } from "@lcds/db";
import {
  catalogSyncPayloadSchema,
  minStockForCategory,
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

function money(value: number) {
  return Math.round(Number(value) * 100) / 100;
}

export type ReportFilters = {
  storeId?: string;
  from?: string;
  to?: string;
  userId?: string;
  customerId?: string;
  productId?: string;
  category?: string;
  customerCategory?: string;
  paymentMethod?: string;
  saleType?: string;
};

/**
 * Filtros de ventas. Con `itemLevel` los filtros de producto/categoría se
 * aplican a cada línea (sale_items `si` + products `p`); sin él, solo filtran
 * qué tickets cuentan (EXISTS).
 */
function salesFilter(filters: ReportFilters, itemLevel = false) {
  const clauses: string[] = ["s.ticket_printed = 1"];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    clauses.push(sql);
    params.push(value);
  };
  if (filters.storeId) add("s.store_id = ?", filters.storeId);
  if (filters.from) add("s.created_at >= ?", filters.from);
  if (filters.to) add("s.created_at <= ?", filters.to);
  if (filters.userId) add("s.user_id = ?", filters.userId);
  if (filters.customerId) add("s.customer_id = ?", filters.customerId);
  if (filters.customerCategory) {
    add("s.customer_category = ?", filters.customerCategory);
  }
  if (filters.paymentMethod) add("s.payment_method = ?", filters.paymentMethod);
  if (filters.saleType) add("s.sale_type = ?", filters.saleType);

  if (itemLevel) {
    if (filters.productId) add("si.product_id = ?", filters.productId);
    if (filters.category) add("p.category = ?", filters.category);
  } else if (filters.productId || filters.category) {
    const inner: string[] = ["si2.sale_id = s.id"];
    if (filters.productId) {
      inner.push("si2.product_id = ?");
      params.push(filters.productId);
    }
    if (filters.category) {
      inner.push("p2.category = ?");
      params.push(filters.category);
    }
    clauses.push(
      `EXISTS (SELECT 1 FROM sale_items si2 JOIN products p2 ON p2.id = si2.product_id WHERE ${inner.join(" AND ")})`,
    );
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, params };
}

const ITEM_COST = "COALESCE(si.unit_cost, p.cost, 0)";

type ItemAggregateRow = {
  tickets: number;
  units: number;
  revenue: number;
  cost: number;
} & Record<string, unknown>;

/** Agrega líneas de venta (ingreso y costo histórico) agrupadas. */
function itemAggregates(
  db: Db,
  filters: ReportFilters,
  selectCols: string,
  groupBy: string,
  orderBy: string,
  joins = "",
): ItemAggregateRow[] {
  const { where, params } = salesFilter(filters, true);
  return db
    .prepare(
      `SELECT ${selectCols},
              COUNT(DISTINCT s.id) AS tickets,
              COUNT(si.id) AS units,
              COALESCE(SUM(si.final_price), 0) AS revenue,
              COALESCE(SUM(${ITEM_COST}), 0) AS cost
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       ${joins}
       ${where}
       GROUP BY ${groupBy}
       ORDER BY ${orderBy}`,
    )
    .all(...params) as ItemAggregateRow[];
}

function metrics(row: { tickets: number; units: number; revenue: number; cost: number }) {
  const revenue = money(row.revenue);
  const cost = money(row.cost);
  return {
    tickets: row.tickets,
    units: row.units,
    revenue,
    cost,
    profit: money(revenue - cost),
    avgTicket: row.tickets ? money(revenue / row.tickets) : 0,
  };
}

function sumMetrics(rows: ReturnType<typeof metrics>[]) {
  const total = rows.reduce(
    (acc, r) => ({
      tickets: acc.tickets + r.tickets,
      units: acc.units + r.units,
      revenue: acc.revenue + r.revenue,
      cost: acc.cost + r.cost,
    }),
    { tickets: 0, units: 0, revenue: 0, cost: 0 },
  );
  return metrics(total);
}

export function productSalesReport(db: Db, filters: ReportFilters) {
  const rows = itemAggregates(
    db,
    filters,
    "p.id AS id, p.code AS code, p.name AS name, p.brand AS brand, p.category AS category",
    "p.id",
    "revenue DESC, p.name COLLATE NOCASE",
  );

  const products = rows.map((row) => {
    const revenue = money(row.revenue);
    const cost = money(row.cost);
    return {
      id: String(row.id),
      code: row.code == null ? null : String(row.code),
      name: String(row.name),
      brand: row.brand == null ? null : String(row.brand),
      category: row.category == null ? null : String(row.category),
      units: row.units,
      revenue,
      avgPrice: row.units ? money(revenue / row.units) : 0,
      cost,
      profit: money(revenue - cost),
    };
  });

  const revenue = money(products.reduce((acc, row) => acc + row.revenue, 0));
  const cost = money(products.reduce((acc, row) => acc + row.cost, 0));
  return {
    products,
    totals: {
      products: products.length,
      units: products.reduce((acc, row) => acc + row.units, 0),
      revenue,
      cost,
      profit: money(revenue - cost),
    },
  };
}

export function salesByProductCategoryReport(db: Db, filters: ReportFilters) {
  const rows = itemAggregates(
    db,
    filters,
    "IFNULL(p.category, 'Otros') AS product_category",
    "IFNULL(p.category, 'Otros')",
    "revenue DESC",
  );
  const categories = rows.map((row) => ({
    category: String(row.product_category),
    ...metrics(row),
  }));
  return { categories, totals: sumMetrics(categories) };
}

export function salesByCustomerCategoryReport(db: Db, filters: ReportFilters) {
  const rows = itemAggregates(
    db,
    filters,
    "s.customer_category AS customer_category",
    "s.customer_category",
    "revenue DESC",
  );
  const mix = itemAggregates(
    db,
    filters,
    "s.customer_category AS customer_category, s.sale_type AS sale_type",
    "s.customer_category, s.sale_type",
    "s.customer_category",
  );
  const categories = rows.map((row) => {
    const own = mix.filter((m) => m.customer_category === row.customer_category);
    const bySaleType = (type: string) => {
      const found = own.find((m) => m.sale_type === type);
      return found ? metrics(found) : metrics({ tickets: 0, units: 0, revenue: 0, cost: 0 });
    };
    return {
      customerCategory: String(row.customer_category),
      ...metrics(row),
      mayoreo: bySaleType("Mayoreo"),
      menudeo: bySaleType("Menudeo"),
    };
  });
  return { categories, totals: sumMetrics(categories) };
}

export function salesByPaymentMethodReport(db: Db, filters: ReportFilters) {
  const rows = itemAggregates(
    db,
    filters,
    "IFNULL(s.payment_method, 'Sin definir') AS payment_method",
    "IFNULL(s.payment_method, 'Sin definir')",
    "revenue DESC",
  );
  const methods = rows.map((row) => ({
    paymentMethod: String(row.payment_method),
    ...metrics(row),
  }));
  const totals = sumMetrics(methods);
  return {
    methods: methods.map((m) => ({
      ...m,
      share: totals.revenue ? money((m.revenue / totals.revenue) * 100) : 0,
    })),
    totals,
  };
}

export function employeeProductivityReport(db: Db, filters: ReportFilters) {
  const select = "s.user_id AS user_id, u.full_name AS employee_name, u.store_id AS employee_store_id";
  const joins = "JOIN users u ON u.id = s.user_id";
  const rows = itemAggregates(
    db,
    filters,
    select,
    "s.user_id",
    "revenue DESC",
    joins,
  );
  const byType = itemAggregates(
    db,
    filters,
    `${select}, s.sale_type AS dim`,
    "s.user_id, s.sale_type",
    "s.user_id",
    joins,
  );
  const byCustomerCategory = itemAggregates(
    db,
    filters,
    `${select}, s.customer_category AS dim`,
    "s.user_id, s.customer_category",
    "s.user_id",
    joins,
  );
  const byPayment = itemAggregates(
    db,
    filters,
    `${select}, IFNULL(s.payment_method, 'Sin definir') AS dim`,
    "s.user_id, IFNULL(s.payment_method, 'Sin definir')",
    "s.user_id",
    joins,
  );
  const byProductCategory = itemAggregates(
    db,
    filters,
    `${select}, IFNULL(p.category, 'Otros') AS dim`,
    "s.user_id, IFNULL(p.category, 'Otros')",
    "s.user_id",
    joins,
  );
  const byStore = itemAggregates(
    db,
    filters,
    `${select}, st.code AS dim`,
    "s.user_id, st.code",
    "s.user_id",
    `${joins} JOIN stores st ON st.id = s.store_id`,
  );

  const breakdown = (source: ItemAggregateRow[], userId: string) =>
    source
      .filter((r) => r.user_id === userId)
      .map((r) => ({ key: String(r.dim), ...metrics(r) }))
      .sort((a, b) => b.revenue - a.revenue);

  const employees = rows.map((row) => {
    const userId = String(row.user_id);
    const types = breakdown(byType, userId);
    return {
      userId,
      employeeName: String(row.employee_name),
      storeId: String(row.employee_store_id),
      ...metrics(row),
      mayoreo: types.find((t) => t.key === "Mayoreo") ?? null,
      menudeo: types.find((t) => t.key === "Menudeo") ?? null,
      bySaleType: types,
      byCustomerCategory: breakdown(byCustomerCategory, userId),
      byProductCategory: breakdown(byProductCategory, userId),
      byPaymentMethod: breakdown(byPayment, userId),
      byStore: breakdown(byStore, userId),
    };
  });
  return { employees, totals: sumMetrics(employees) };
}

export function customerSalesReport(db: Db, filters: ReportFilters) {
  const rows = itemAggregates(
    db,
    filters,
    `s.customer_id AS customer_id, c.name AS customer_name, c.client_number AS client_number,
     c.category AS customer_category, MAX(s.created_at) AS last_purchase_at`,
    "s.customer_id",
    "revenue DESC",
    "LEFT JOIN customers c ON c.id = s.customer_id",
  );
  const customers = rows.map((row) => ({
    customerId: row.customer_id == null ? null : String(row.customer_id),
    customerName:
      row.customer_name == null
        ? "Mostrador (sin cliente)"
        : String(row.customer_name),
    clientNumber: row.client_number == null ? null : String(row.client_number),
    customerCategory:
      row.customer_category == null ? null : String(row.customer_category),
    lastPurchaseAt:
      row.last_purchase_at == null ? null : String(row.last_purchase_at),
    ...metrics(row),
  }));
  return { customers, totals: sumMetrics(customers) };
}

export function salesReport(
  db: Db,
  filters: ReportFilters,
  options: { cashCut?: boolean } = {},
) {
  const { where, params } = salesFilter(filters);

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

  const costRow = db
    .prepare(
      `SELECT COALESCE(SUM(${ITEM_COST}), 0) AS cost
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       ${where}`,
    )
    .get(...params) as { cost: number };
  const costTotal = money(costRow.cost);
  const revenueTotal = money(revenue);

  const report = {
    sales: rows.map((r) => ({
      ...mapSale(r),
      employeeName: String(r.employee_name),
      storeName: String(r.store_name),
      storeCode: String(r.store_code),
    })),
    totals: {
      salesCount,
      lotsSold,
      revenue: revenueTotal,
      cost: costTotal,
      profit: money(revenueTotal - costTotal),
    },
  };

  if (!options.cashCut) return report;

  const cut = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN s.payment_method = 'Efectivo' THEN s.total ELSE 0 END), 0) AS efectivo,
         COALESCE(SUM(CASE WHEN s.payment_method = 'Tarjeta' THEN s.total ELSE 0 END), 0) AS tarjeta,
         COALESCE(SUM(CASE WHEN s.payment_method = 'Transferencia' THEN s.total ELSE 0 END), 0) AS transferencia,
         COALESCE(SUM(CASE WHEN s.payment_method = 'Saldo' THEN s.total ELSE 0 END), 0) AS saldo,
         COALESCE(SUM(CASE WHEN s.payment_method IS NULL THEN s.total ELSE 0 END), 0) AS sin_metodo,
         COALESCE(SUM(CASE WHEN s.payment_method = 'Saldo' THEN 1 ELSE 0 END), 0) AS n_saldo,
         COALESCE(SUM(CASE WHEN s.payment_method = 'Efectivo' THEN 1 ELSE 0 END), 0) AS n_efectivo,
         COALESCE(SUM(CASE WHEN s.payment_method = 'Tarjeta' THEN 1 ELSE 0 END), 0) AS n_tarjeta,
         COALESCE(SUM(CASE WHEN s.payment_method = 'Transferencia' THEN 1 ELSE 0 END), 0) AS n_transferencia,
         COALESCE(SUM(CASE WHEN s.payment_method IS NULL THEN 1 ELSE 0 END), 0) AS n_sin_metodo
       FROM sales s
       ${where}`,
    )
    .get(...params) as {
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    saldo: number;
    sin_metodo: number;
    n_saldo: number;
    n_efectivo: number;
    n_tarjeta: number;
    n_transferencia: number;
    n_sin_metodo: number;
  };

  const byStore = (
    db
      .prepare(
        `SELECT st.code AS store_code, st.name AS store_name,
           COALESCE(SUM(CASE WHEN s.payment_method = 'Efectivo' THEN s.total ELSE 0 END), 0) AS efectivo,
           COALESCE(SUM(CASE WHEN s.payment_method = 'Tarjeta' THEN s.total ELSE 0 END), 0) AS tarjeta,
           COALESCE(SUM(CASE WHEN s.payment_method = 'Transferencia' THEN s.total ELSE 0 END), 0) AS transferencia,
           COALESCE(SUM(CASE WHEN s.payment_method = 'Saldo' THEN s.total ELSE 0 END), 0) AS saldo
         FROM sales s
         JOIN stores st ON st.id = s.store_id
         ${where}
         GROUP BY st.id
         HAVING COUNT(*) > 0
         ORDER BY st.code`,
      )
      .all(...params) as {
      store_code: string;
      store_name: string;
      efectivo: number;
      tarjeta: number;
      transferencia: number;
      saldo: number;
    }[]
  ).map((row) => ({
    storeCode: row.store_code,
    storeName: row.store_name,
    efectivo: money(row.efectivo),
    tarjeta: money(row.tarjeta),
    transferencia: money(row.transferencia),
    salesCredit: money(row.saldo),
  }));

  return {
    ...report,
    cashCut: {
      efectivo: money(cut.efectivo),
      tarjeta: money(cut.tarjeta),
      transferencia: money(cut.transferencia),
      salesCredit: money(cut.saldo),
      sinMetodo: money(cut.sin_metodo),
      counts: {
        efectivo: cut.n_efectivo,
        tarjeta: cut.n_tarjeta,
        transferencia: cut.n_transferencia,
        salesCredit: cut.n_saldo,
        sinMetodo: cut.n_sin_metodo,
      },
      byStore,
    },
  };
}

function periodBounds(period: "dia" | "mes" | "general", today = new Date()) {
  if (period === "general") return {} as { from?: string; to?: string };
  const to = new Date(today);
  to.setHours(23, 59, 59, 999);
  const from = new Date(today);
  from.setHours(0, 0, 0, 0);
  if (period === "mes") from.setDate(1);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Utilidad (ingreso − costo Excel) del día, mes, general; por cuenta y/o sucursal. */
export function profitSummary(
  db: Db,
  filters: { storeId?: string; userId?: string } = {},
) {
  function snapshot(period: "dia" | "mes" | "general") {
    const range = periodBounds(period);
    const reportFilters: ReportFilters = { ...filters, ...range };
    const { where, params } = salesFilter(reportFilters, true);

    const totalsRow = db
      .prepare(
        `SELECT
           COUNT(DISTINCT s.id) AS tickets,
           COUNT(si.id) AS units,
           COALESCE(SUM(si.final_price), 0) AS revenue,
           COALESCE(SUM(${ITEM_COST}), 0) AS cost,
           COALESCE(SUM(CASE WHEN ${ITEM_COST} = 0 AND (si.unit_cost IS NULL AND p.cost IS NULL) THEN 1 ELSE 0 END), 0) AS units_without_cost
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         ${where}`,
      )
      .get(...params) as {
      tickets: number;
      units: number;
      revenue: number;
      cost: number;
      units_without_cost: number;
    };

    const m = metrics(totalsRow);
    const margin =
      m.revenue > 0 ? money((m.profit / m.revenue) * 100) : 0;

    const joinParts = ["s.store_id = st.id", "s.ticket_printed = 1"];
    const storeParams: unknown[] = [];
    if (filters.userId) {
      joinParts.push("s.user_id = ?");
      storeParams.push(filters.userId);
    }
    if (range.from) {
      joinParts.push("s.created_at >= ?");
      storeParams.push(range.from);
    }
    if (range.to) {
      joinParts.push("s.created_at <= ?");
      storeParams.push(range.to);
    }
    const storeWhere = filters.storeId ? "WHERE st.id = ?" : "";
    if (filters.storeId) storeParams.push(filters.storeId);

    const byStore = (
      db
        .prepare(
          `SELECT st.id AS store_id, st.code AS store_code, st.name AS store_name,
                  COUNT(DISTINCT s.id) AS tickets,
                  COUNT(si.id) AS units,
                  COALESCE(SUM(si.final_price), 0) AS revenue,
                  COALESCE(SUM(${ITEM_COST}), 0) AS cost
           FROM stores st
           LEFT JOIN sales s ON ${joinParts.join(" AND ")}
           LEFT JOIN sale_items si ON si.sale_id = s.id
           LEFT JOIN products p ON p.id = si.product_id
           ${storeWhere}
           GROUP BY st.id
           ORDER BY st.code`,
        )
        .all(...storeParams) as {
        store_id: string;
        store_code: string;
        store_name: string;
        tickets: number;
        units: number;
        revenue: number;
        cost: number;
      }[]
    ).map((row) => {
      const storeMetrics = metrics(row);
      return {
        storeId: row.store_id,
        storeCode: row.store_code,
        storeName: row.store_name,
        ...storeMetrics,
        margin:
          storeMetrics.revenue > 0
            ? money((storeMetrics.profit / storeMetrics.revenue) * 100)
            : 0,
      };
    });

    return {
      period,
      ...m,
      margin,
      unitsWithoutCost: Number(totalsRow.units_without_cost),
      byStore,
    };
  }

  const missingCostProducts = (
    db
      .prepare(
        `SELECT code, brand, name FROM products
         WHERE active = 1 AND (cost IS NULL OR cost = 0)
         ORDER BY code`,
      )
      .all() as { code: string | null; brand: string | null; name: string }[]
  ).map((row) => ({
    code: row.code,
    brand: row.brand,
    name: row.name,
  }));

  return {
    day: snapshot("dia"),
    month: snapshot("mes"),
    all: snapshot("general"),
    missingCostProducts,
    note: "Utilidad = precio final vendido − costo del Excel (products.cost / unit_cost).",
  };
}

export function inventorySummary(db: Db, storeId?: string) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (storeId) {
    clauses.push("l.store_id = ?");
    params.push(storeId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN l.status = 'Disponible' THEN 1 ELSE 0 END), 0) AS disponible,
         COALESCE(SUM(CASE WHEN l.status = 'Vendido' THEN 1 ELSE 0 END), 0) AS vendido
       FROM lots l
       ${where}`,
    )
    .get(...params) as { disponible: number; vendido: number };

  const byStore = (
    db
      .prepare(
        `SELECT st.id AS store_id, st.code AS store_code, st.name AS store_name,
                COALESCE(SUM(CASE WHEN l.status = 'Disponible' THEN 1 ELSE 0 END), 0) AS disponible,
                COALESCE(SUM(CASE WHEN l.status = 'Vendido' THEN 1 ELSE 0 END), 0) AS vendido
         FROM stores st
         LEFT JOIN lots l ON l.store_id = st.id
         ${storeId ? "WHERE st.id = ?" : ""}
         GROUP BY st.id
         ORDER BY st.code`,
      )
      .all(...(storeId ? [storeId] : [])) as {
      store_id: string;
      store_code: string;
      store_name: string;
      disponible: number;
      vendido: number;
    }[]
  ).map((row) => ({
    storeId: row.store_id,
    storeCode: row.store_code,
    storeName: row.store_name,
    disponible: Number(row.disponible),
    vendido: Number(row.vendido),
  }));

  const productParams: unknown[] = [];
  let productWhere = "WHERE p.active = 1";
  if (storeId) {
    productWhere += " AND l.store_id = ?";
    productParams.push(storeId);
  }

  const products = (
    db
      .prepare(
        `SELECT p.id, p.code, p.name, p.brand, p.category,
                COALESCE(SUM(CASE WHEN l.status = 'Disponible' THEN 1 ELSE 0 END), 0) AS disponible,
                COALESCE(SUM(CASE WHEN l.status = 'Vendido' THEN 1 ELSE 0 END), 0) AS vendido
         FROM products p
         LEFT JOIN lots l ON l.product_id = p.id
         ${productWhere}
         GROUP BY p.id
         HAVING disponible > 0 OR vendido > 0
         ORDER BY disponible ASC, p.name COLLATE NOCASE
         LIMIT 500`,
      )
      .all(...productParams) as {
      id: string;
      code: string | null;
      name: string;
      brand: string | null;
      category: string | null;
      disponible: number;
      vendido: number;
    }[]
  ).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    brand: row.brand,
    category: row.category,
    disponible: Number(row.disponible),
    vendido: Number(row.vendido),
  }));

  const withThreshold = products.map((p) => {
    const minimum = minStockForCategory(p.category);
    return { ...p, minimum, belowMin: p.disponible < minimum };
  });

  return {
    Disponible: Number(totals.disponible),
    Vendido: Number(totals.vendido),
    byStore,
    products: withThreshold,
    lowStock: withThreshold.filter((p) => p.disponible > 0 && p.belowMin),
    outOfStock: withThreshold.filter((p) => p.disponible === 0),
  };
}

/** Productos bajo el mínimo por categoría (alerta de login admin). */
export function stockAlerts(db: Db, storeId?: string) {
  const summary = inventorySummary(db, storeId);
  const alerts = [...summary.outOfStock, ...summary.lowStock]
    .map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      brand: p.brand,
      category: p.category ?? "Otros",
      disponible: p.disponible,
      minimum: p.minimum,
      message:
        p.disponible <= 0
          ? `Ya no quedan piezas de «${p.name}» (${p.category ?? "Otros"}). Mínimo: ${p.minimum}.`
          : `Ya solo quedan ${p.disponible} de «${p.name}» (${p.category ?? "Otros"}). Mínimo: ${p.minimum}.`,
    }))
    .sort((a, b) => a.disponible - b.disponible || a.name.localeCompare(b.name, "es"));

  const byCategory = new Map<
    string,
    { category: string; minimum: number; products: number; worst: number }
  >();
  for (const item of alerts) {
    const current = byCategory.get(item.category) ?? {
      category: item.category,
      minimum: item.minimum,
      products: 0,
      worst: item.disponible,
    };
    current.products += 1;
    current.worst = Math.min(current.worst, item.disponible);
    byCategory.set(item.category, current);
  }

  return {
    count: alerts.length,
    alerts: alerts.slice(0, 40),
    byCategory: [...byCategory.values()].sort((a, b) =>
      a.category.localeCompare(b.category, "es"),
    ),
  };
}
