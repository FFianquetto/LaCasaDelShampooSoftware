import { boolToInt, newId, nowIso, type Db } from "@lcds/db";
import type {
  CreateProductInput,
  CreateLotInput,
  CreateCustomerInput,
  UpdateCustomerRuleInput,
  UpdateCustomerInput,
  UpsertPriceInput,
  UpsertProductCostInput,
  PriceCostHistory,
  CreateUserInput,
  CreatePromotionInput,
  Product,
  Lot,
  Customer,
  CustomerFrequency,
  PriceListItem,
  User,
  Promotion,
  CustomerCategory,
  SaleType,
} from "@lcds/shared";
import {
  DEFAULT_PURCHASE_EVERY_DAYS,
  isDistributorCategory,
} from "@lcds/shared";
import { AppError, assertFound } from "../errors.js";
import {
  mapCustomer,
  mapLot,
  mapPrice,
  mapProduct,
  mapPromotion,
  mapUser,
} from "../mappers.js";
import { hashPassword } from "./auth.js";

export function listProducts(
  db: Db,
  filters: { activeOnly?: boolean; category?: string; q?: string } = {},
): Product[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.activeOnly) clauses.push("active = 1");
  if (filters.category) {
    clauses.push("category = ?");
    params.push(filters.category);
  }
  if (filters.q) {
    clauses.push("(name LIKE ? OR brand LIKE ? OR sku LIKE ? OR code LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return (
    db
      .prepare(
        `SELECT * FROM products ${where} ORDER BY code, name LIMIT 2000`,
      )
      .all(...params) as Record<string, unknown>[]
  ).map(mapProduct);
}

export type CatalogItem = Product & {
  disponible: number;
  vendido: number;
  price: number | null;
  tacha?: boolean;
};

export function listCatalog(
  db: Db,
  filters: { storeId?: string; q?: string },
): CatalogItem[] {
  const storeId = filters.storeId ?? "";
  const clauses: string[] = ["p.active = 1"];
  const params: unknown[] = [];
  const lotWhere = storeId ? "WHERE store_id = ?" : "";
  if (storeId) params.push(storeId);

  const markColumn = db
    .prepare("PRAGMA table_info(inventory_marks)")
    .all() as { name: string }[];
  const canMark =
    Boolean(storeId) && markColumn.some((column) => column.name === "product_id");
  const markJoin = canMark
    ? "LEFT JOIN inventory_marks m ON m.product_id = p.id AND m.store_id = ?"
    : "";
  const tachaSql = canMark
    ? "CASE WHEN m.product_id IS NOT NULL THEN 1 ELSE 0 END"
    : "0";
  if (canMark) params.push(storeId);

  if (filters.q) {
    clauses.push(
      "(p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ? OR p.code LIKE ?)",
    );
    const like = `%${filters.q}%`;
    params.push(like, like, like, like);
  }

  const rows = db
    .prepare(
      `SELECT p.*,
              IFNULL(stock.disponible, 0) AS disponible,
              IFNULL(stock.vendido, 0) AS vendido,
              pl.price AS price,
              ${tachaSql} AS tacha
       FROM products p
       LEFT JOIN (
         SELECT product_id,
                SUM(CASE WHEN status = 'Disponible' THEN 1 ELSE 0 END) AS disponible,
                SUM(CASE WHEN status = 'Vendido' THEN 1 ELSE 0 END) AS vendido
         FROM lots
         ${lotWhere}
         GROUP BY product_id
       ) stock ON stock.product_id = p.id
       LEFT JOIN price_list pl
         ON pl.product_id = p.id
        AND pl.customer_category = 'Publico'
        AND pl.sale_type = 'Menudeo'
       ${markJoin}
       WHERE ${clauses.join(" AND ")}
       ORDER BY p.code`,
    )
    .all(...params) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...mapProduct(row),
    disponible: Number(row.disponible ?? 0),
    vendido: Number(row.vendido ?? 0),
    price: row.price == null ? null : Number(row.price),
    tacha: Number(row.tacha) === 1,
  }));
}

export function listProductCategories(db: Db): { category: string; count: number }[] {
  return db
    .prepare(
      `SELECT IFNULL(category, 'Otros') AS category, COUNT(*) AS count
       FROM products WHERE active = 1
       GROUP BY IFNULL(category, 'Otros')
       ORDER BY category`,
    )
    .all() as { category: string; count: number }[];
}

function nextProductCode(db: Db): string {
  const rows = db
    .prepare("SELECT code FROM products WHERE code GLOB 'P[0-9]*'")
    .all() as { code: string }[];
  let max = 0;
  for (const row of rows) {
    const value = Number(row.code.slice(1));
    if (Number.isInteger(value)) max = Math.max(max, value);
  }
  return `P${String(max + 1).padStart(4, "0")}`;
}

export function createProduct(db: Db, input: CreateProductInput): Product {
  const id = newId("prd");
  const code = nextProductCode(db);
  try {
    db.prepare(
      `INSERT INTO products (id, sku, name, brand, category, code, barcode, cost, description, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      input.sku,
      input.name,
      input.brand ?? null,
      input.category ?? null,
      code,
      code,
      input.cost ?? null,
      input.description ?? null,
      nowIso(),
    );
  } catch {
    throw new AppError("SKU duplicado", 409, "DUPLICATE");
  }
  return assertFound(
    mapProduct(
      db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Record<
        string,
        unknown
      >,
    ),
    "Producto no creado",
  );
}

export function updateProduct(
  db: Db,
  id: string,
  patch: Partial<CreateProductInput> & { active?: boolean },
): Product {
  const current = assertFound(
    db.prepare("SELECT * FROM products WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined,
    "Producto no encontrado",
  );

  db.prepare(
    `UPDATE products SET sku = ?, name = ?, brand = ?, category = ?, cost = ?, description = ?, active = ? WHERE id = ?`,
  ).run(
    patch.sku ?? current.sku,
    patch.name ?? current.name,
    patch.brand !== undefined ? patch.brand : current.brand,
    patch.category !== undefined ? patch.category : current.category,
    patch.cost !== undefined ? patch.cost : current.cost,
    patch.description !== undefined
      ? patch.description
      : current.description,
    patch.active !== undefined ? boolToInt(patch.active) : current.active,
    id,
  );

  return mapProduct(
    db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
}

/** Existencias del producto desglosadas por sucursal. */
export function productStockByStore(
  db: Db,
  productId: string,
  storeId?: string,
): {
  storeId: string;
  storeCode: string;
  storeName: string;
  disponible: number;
  vendido: number;
}[] {
  assertFound(
    db.prepare("SELECT id FROM products WHERE id = ?").get(productId),
    "Producto no encontrado",
  );
  const clauses = ["1 = 1"];
  const params: unknown[] = [productId];
  if (storeId) {
    clauses.push("st.id = ?");
    params.push(storeId);
  }
  return (
    db
      .prepare(
        `SELECT st.id AS store_id, st.code AS store_code, st.name AS store_name,
                IFNULL(SUM(CASE WHEN l.status = 'Disponible' THEN 1 ELSE 0 END), 0) AS disponible,
                IFNULL(SUM(CASE WHEN l.status = 'Vendido' THEN 1 ELSE 0 END), 0) AS vendido
         FROM stores st
         LEFT JOIN lots l ON l.store_id = st.id AND l.product_id = ?
         WHERE ${clauses.join(" AND ")}
         GROUP BY st.id
         ORDER BY st.code`,
      )
      .all(...params) as {
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
}

export function listLots(
  db: Db,
  filters: { storeId?: string; status?: string; q?: string },
): (Lot & { productName?: string })[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.storeId) {
    clauses.push("l.store_id = ?");
    params.push(filters.storeId);
  }
  if (filters.status) {
    clauses.push("l.status = ?");
    params.push(filters.status);
  }
  if (filters.q) {
    clauses.push("(l.barcode LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT l.*, p.name AS product_name
       FROM lots l JOIN products p ON p.id = l.product_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT 500`,
    )
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => ({
    ...mapLot(r),
    productName: String(r.product_name),
  }));
}

export function createLot(db: Db, input: CreateLotInput): Lot {
  assertFound(
    db.prepare("SELECT id FROM products WHERE id = ?").get(input.productId),
    "Producto no encontrado",
  );
  assertFound(
    db.prepare("SELECT id FROM stores WHERE id = ?").get(input.storeId),
    "Sucursal no encontrada",
  );

  const id = newId("lot");
  try {
    db.prepare(
      `INSERT INTO lots (id, barcode, product_id, store_id, status, created_at)
       VALUES (?, ?, ?, ?, 'Disponible', ?)`,
    ).run(id, input.barcode.trim(), input.productId, input.storeId, nowIso());
  } catch {
    throw new AppError("Código de barras ya registrado", 409, "DUPLICATE");
  }

  return mapLot(
    db.prepare("SELECT * FROM lots WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
}

export function getLotByBarcode(db: Db, barcode: string): Lot & {
  productName: string;
  sku: string;
} {
  const row = db
    .prepare(
      `SELECT l.*, p.name AS product_name, p.sku
       FROM lots l JOIN products p ON p.id = l.product_id
       WHERE l.barcode = ?`,
    )
    .get(barcode.trim()) as Record<string, unknown> | undefined;

  const found = assertFound(row, "Lote no encontrado");
  return {
    ...mapLot(found),
    productName: String(found.product_name),
    sku: String(found.sku),
  };
}

function mexicoDay(value: Date | string): number {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [year, month, day] = parts.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysBetween(fromIso: string, to: Date): number {
  return Math.round((mexicoDay(to) - mexicoDay(fromIso)) / 86_400_000);
}

/** Misma lógica que productos (P0001): secuencia única C0001, C0002… */
function nextClientNumber(db: Db): string {
  const rows = db
    .prepare(
      `SELECT client_number FROM customers
       WHERE client_number GLOB 'C[0-9]*'`,
    )
    .all() as { client_number: string }[];
  let max = 0;
  for (const row of rows) {
    const value = Number(row.client_number.slice(1));
    if (Number.isInteger(value)) max = Math.max(max, value);
  }
  return `C${String(max + 1).padStart(4, "0")}`;
}

function attachTotalSpent(db: Db, customers: Customer[]): Customer[] {
  if (customers.length === 0) return customers;
  const spentStmt = db.prepare(
    `SELECT COALESCE(SUM(s.total), 0) AS total
     FROM sales s
     WHERE s.ticket_printed = 1
       AND (
         s.customer_id = ?
         OR (
           ? IS NOT NULL AND ? != ''
           AND lower(IFNULL(s.ticket_email, '')) = lower(?)
         )
       )`,
  );
  return customers.map((customer) => {
    const email = customer.email?.trim() || null;
    const row = spentStmt.get(
      customer.id,
      email,
      email ?? "",
      email ?? "",
    ) as { total: number };
    return {
      ...customer,
      totalSpent: money(row.total),
    };
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function money(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

function assertClientNumberFree(db: Db, clientNumber: string, exceptId?: string) {
  const taken = db
    .prepare(
      `SELECT id FROM customers
       WHERE client_number = ? AND id != ?`,
    )
    .get(clientNumber, exceptId ?? "") as { id: string } | undefined;
  if (taken) throw new AppError("Ese número de cliente ya existe", 409);
}

function frequencyFor(
  customer: Customer,
  stats:
    | { sales_count: number; first_purchase_at: string; last_purchase_at: string }
    | undefined,
  now: Date,
): CustomerFrequency | null {
  const distributor = isDistributorCategory(customer.category);
  if (!distributor && customer.purchaseEveryDays == null) return null;
  const salesCount = stats?.sales_count ?? 0;
  const lastPurchaseAt = stats?.last_purchase_at ?? null;
  const avgDaysBetween =
    stats && salesCount >= 2
      ? Math.round(
          (mexicoDay(stats.last_purchase_at) - mexicoDay(stats.first_purchase_at)) /
            86_400_000 /
            (salesCount - 1),
        )
      : null;

  if (customer.purchaseEveryDays == null) {
    return {
      salesCount,
      lastPurchaseAt,
      nextPurchaseAt: null,
      avgDaysBetween,
      daysSinceAnchor: null,
      daysOverdue: null,
      status: "sin_regla",
    };
  }

  const every = customer.purchaseEveryDays;
  const anchor = lastPurchaseAt ?? customer.createdAt;
  const daysSinceAnchor = Math.max(0, daysBetween(anchor, now));
  const nextPurchaseAt = new Date(
    new Date(anchor).getTime() + every * 86_400_000,
  ).toISOString();
  const status: CustomerFrequency["status"] =
    daysSinceAnchor <= every * 0.8
      ? "al_dia"
      : daysSinceAnchor <= every
        ? "proximo"
        : "atrasado";
  return {
    salesCount,
    lastPurchaseAt,
    nextPurchaseAt,
    avgDaysBetween,
    daysSinceAnchor,
    daysOverdue: Math.max(0, daysSinceAnchor - every),
    status,
  };
}

export function listCustomers(
  db: Db,
  storeId?: string,
  withFrequency = false,
  includeInactive = false,
): Customer[] {
  const activeClause = includeInactive ? "1 = 1" : "active = 1";
  const rows = storeId
    ? (db
        .prepare(
          `SELECT * FROM customers
           WHERE ${activeClause} AND (store_id = ? OR store_id IS NULL)
           ORDER BY name`,
        )
        .all(storeId) as Record<string, unknown>[])
    : (db
        .prepare(
          `SELECT * FROM customers WHERE ${activeClause} ORDER BY name`,
        )
        .all() as Record<string, unknown>[]);
  const customers = attachTotalSpent(db, rows.map(mapCustomer));
  if (!withFrequency) return customers;

  const stats = db
    .prepare(
      `SELECT customer_id, COUNT(*) AS sales_count,
              MIN(created_at) AS first_purchase_at,
              MAX(created_at) AS last_purchase_at
       FROM sales
       WHERE ticket_printed = 1 AND customer_id IS NOT NULL
       GROUP BY customer_id`,
    )
    .all() as {
    customer_id: string;
    sales_count: number;
    first_purchase_at: string;
    last_purchase_at: string;
  }[];
  const byCustomer = new Map(stats.map((row) => [row.customer_id, row]));
  const now = new Date();
  return customers.map((customer) => ({
    ...customer,
    frequency: frequencyFor(customer, byCustomer.get(customer.id), now),
  }));
}

export function createCustomer(
  db: Db,
  input: CreateCustomerInput,
): Customer {
  assertFound(
    db.prepare("SELECT id FROM stores WHERE id = ?").get(input.storeId),
    "Sucursal no encontrada",
  );
  const distributor = isDistributorCategory(input.category);
  const clientNumber = input.clientNumber?.trim() || nextClientNumber(db);
  const purchaseEveryDays =
    input.purchaseEveryDays ??
    (distributor ? DEFAULT_PURCHASE_EVERY_DAYS : null);
  assertClientNumberFree(db, clientNumber);

  const phone = input.phone?.trim() || null;
  const email = input.email?.trim() || null;
  if (!phone && !email) {
    throw new AppError("Escribe el teléfono o el correo. Con uno basta.", 400);
  }
  if (email && !EMAIL_RE.test(email)) {
    throw new AppError("El correo no es válido", 400);
  }
  const address = input.address?.trim() || null;
  const branchName = input.branchName?.trim() || null;

  const id = newId("cus");
  db.prepare(
    `INSERT INTO customers
     (id, name, category, phone, email, address, branch_name, store_id, client_number, purchase_every_days, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    id,
    input.name,
    input.category,
    phone,
    email,
    address,
    branchName,
    input.storeId,
    clientNumber,
    purchaseEveryDays,
    nowIso(),
  );
  return attachTotalSpent(db, [
    mapCustomer(
      db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Record<
        string,
        unknown
      >,
    ),
  ])[0];
}

/** Edita datos del cliente sin tocar su historial de ventas. */
export function updateCustomer(
  db: Db,
  id: string,
  input: UpdateCustomerInput,
): Customer {
  const current = assertFound(
    db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined,
    "Cliente no encontrado",
  );
  const before = mapCustomer(current);

  const name = input.name !== undefined ? input.name.trim() : before.name;
  if (!name) throw new AppError("Escribe el nombre del cliente", 400);

  const category = input.category ?? before.category;
  const categoryChanged = category !== before.category;

  const phone =
    input.phone !== undefined ? input.phone?.trim() || null : before.phone;
  const email =
    input.email !== undefined ? input.email?.trim() || null : before.email;
  if (email && !EMAIL_RE.test(email)) {
    throw new AppError("El correo no es válido", 400);
  }
  if (
    (input.phone !== undefined || input.email !== undefined) &&
    !phone &&
    !email
  ) {
    throw new AppError("Deja al menos el teléfono o el correo", 400);
  }

  const address =
    input.address !== undefined
      ? input.address?.trim() || null
      : before.address;
  const branchName =
    input.branchName !== undefined
      ? input.branchName?.trim() || null
      : before.branchName;

  let storeId = before.storeId;
  if (input.storeId !== undefined) {
    if (input.storeId !== null) {
      assertFound(
        db.prepare("SELECT id FROM stores WHERE id = ?").get(input.storeId),
        "Sucursal no encontrada",
      );
    }
    storeId = input.storeId;
  }

  let clientNumber = before.clientNumber;
  if (input.clientNumber !== undefined) {
    clientNumber = input.clientNumber.trim();
  } else if (!clientNumber) {
    clientNumber = nextClientNumber(db);
  }
  if (clientNumber !== before.clientNumber) {
    assertClientNumberFree(db, clientNumber, id);
  }

  let purchaseEveryDays = before.purchaseEveryDays;
  if (input.purchaseEveryDays !== undefined) {
    purchaseEveryDays = input.purchaseEveryDays;
  } else if (
    categoryChanged &&
    isDistributorCategory(category) &&
    purchaseEveryDays == null
  ) {
    purchaseEveryDays = DEFAULT_PURCHASE_EVERY_DAYS;
  }

  const active = input.active ?? before.active;

  db.prepare(
    `UPDATE customers
     SET name = ?, category = ?, phone = ?, email = ?, address = ?, branch_name = ?,
         store_id = ?, client_number = ?, purchase_every_days = ?, active = ?
     WHERE id = ?`,
  ).run(
    name,
    category,
    phone,
    email,
    address,
    branchName,
    storeId,
    clientNumber,
    purchaseEveryDays,
    boolToInt(active),
    id,
  );

  return attachTotalSpent(db, [
    mapCustomer(
      db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Record<
        string,
        unknown
      >,
    ),
  ])[0];
}

/** Compatibilidad: redirige a updateCustomer. */
export function updateCustomerRule(
  db: Db,
  id: string,
  input: UpdateCustomerRuleInput,
): Customer {
  return updateCustomer(db, id, {
    clientNumber: input.clientNumber,
    purchaseEveryDays: input.purchaseEveryDays,
  });
}

export type CustomerPurchaseAnalysis = {
  customer: Customer;
  summary: {
    salesCount: number;
    units: number;
    revenue: number;
    cost: number;
    profit: number;
    avgTicket: number;
    firstPurchaseAt: string | null;
    lastPurchaseAt: string | null;
  };
  products: {
    productId: string;
    code: string | null;
    name: string;
    brand: string | null;
    category: string | null;
    units: number;
    revenue: number;
    cost: number;
    profit: number;
  }[];
  paymentMethods: {
    paymentMethod: string;
    salesCount: number;
    revenue: number;
  }[];
  sales: {
    id: string;
    folio: string;
    createdAt: string;
    storeName: string;
    employeeName: string;
    saleType: string;
    paymentMethod: string | null;
    units: number;
    total: number;
  }[];
};

export function customerPurchaseAnalysis(
  db: Db,
  customerId: string,
  filters: { storeId?: string; from?: string; to?: string } = {},
): CustomerPurchaseAnalysis {
  const row = assertFound(
    db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as
      | Record<string, unknown>
      | undefined,
    "Cliente no encontrado",
  );
  const customer = mapCustomer(row);

  const clauses = ["s.customer_id = ?", "s.ticket_printed = 1"];
  const params: unknown[] = [customerId];
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

  const productRows = db
    .prepare(
      `SELECT p.id AS product_id, p.code, p.name, p.brand, p.category,
              COUNT(si.id) AS units,
              COALESCE(SUM(si.final_price), 0) AS revenue,
              COALESCE(SUM(COALESCE(si.unit_cost, p.cost, 0)), 0) AS cost
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       ${where}
       GROUP BY p.id
       ORDER BY revenue DESC, p.name COLLATE NOCASE`,
    )
    .all(...params) as {
    product_id: string;
    code: string | null;
    name: string;
    brand: string | null;
    category: string | null;
    units: number;
    revenue: number;
    cost: number;
  }[];

  const products = productRows.map((r) => ({
    productId: r.product_id,
    code: r.code,
    name: r.name,
    brand: r.brand,
    category: r.category,
    units: r.units,
    revenue: money(r.revenue),
    cost: money(r.cost),
    profit: money(r.revenue - r.cost),
  }));

  const payRows = db
    .prepare(
      `SELECT IFNULL(s.payment_method, 'Sin definir') AS payment_method,
              COUNT(*) AS sales_count,
              COALESCE(SUM(s.total), 0) AS revenue
       FROM sales s
       ${where}
       GROUP BY IFNULL(s.payment_method, 'Sin definir')
       ORDER BY revenue DESC`,
    )
    .all(...params) as {
    payment_method: string;
    sales_count: number;
    revenue: number;
  }[];

  const saleRows = db
    .prepare(
      `SELECT s.id, s.folio, s.created_at, s.sale_type, s.payment_method, s.total,
              st.name AS store_name, u.full_name AS employee_name,
              (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS units
       FROM sales s
       JOIN stores st ON st.id = s.store_id
       JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT 300`,
    )
    .all(...params) as Record<string, unknown>[];

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sales_count,
              COALESCE(SUM(s.total), 0) AS revenue,
              MIN(s.created_at) AS first_at,
              MAX(s.created_at) AS last_at
       FROM sales s
       ${where}`,
    )
    .get(...params) as {
    sales_count: number;
    revenue: number;
    first_at: string | null;
    last_at: string | null;
  };

  const units = products.reduce((acc, p) => acc + p.units, 0);
  const cost = products.reduce((acc, p) => acc + p.cost, 0);
  const revenue = money(totals.revenue);

  const stats = db
    .prepare(
      `SELECT COUNT(*) AS sales_count,
              MIN(created_at) AS first_purchase_at,
              MAX(created_at) AS last_purchase_at
       FROM sales WHERE ticket_printed = 1 AND customer_id = ?`,
    )
    .get(customerId) as
    | { sales_count: number; first_purchase_at: string; last_purchase_at: string }
    | undefined;
  customer.frequency = frequencyFor(
    customer,
    stats && stats.sales_count > 0 ? stats : undefined,
    new Date(),
  );

  return {
    customer,
    summary: {
      salesCount: totals.sales_count,
      units,
      revenue,
      cost: money(cost),
      // La utilidad se calcula sobre lo vendido con descuentos aplicados.
      profit: money(products.reduce((acc, p) => acc + p.profit, 0)),
      avgTicket: totals.sales_count
        ? money(revenue / totals.sales_count)
        : 0,
      firstPurchaseAt: totals.first_at,
      lastPurchaseAt: totals.last_at,
    },
    products,
    paymentMethods: payRows.map((r) => ({
      paymentMethod: r.payment_method,
      salesCount: r.sales_count,
      revenue: money(r.revenue),
    })),
    sales: saleRows.map((r) => ({
      id: String(r.id),
      folio: String(r.folio),
      createdAt: String(r.created_at),
      storeName: String(r.store_name),
      employeeName: String(r.employee_name),
      saleType: String(r.sale_type),
      paymentMethod: r.payment_method == null ? null : String(r.payment_method),
      units: Number(r.units),
      total: money(Number(r.total)),
    })),
  };
}

export function listPrices(db: Db, productId?: string): PriceListItem[] {
  const rows = productId
    ? (db
        .prepare("SELECT * FROM price_list WHERE product_id = ?")
        .all(productId) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM price_list").all() as Record<
        string,
        unknown
      >[]);
  return rows.map(mapPrice);
}

function todayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function insertPriceCostHistory(
  db: Db,
  row: {
    productId: string;
    kind: "cost" | "price";
    customerCategory?: string | null;
    saleType?: string | null;
    previousValue: number | null;
    newValue: number;
    effectiveDate: string;
    note?: string | null;
    userId?: string | null;
  },
) {
  db.prepare(
    `INSERT INTO price_cost_history
       (id, product_id, kind, customer_category, sale_type,
        previous_value, new_value, effective_date, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("pch"),
    row.productId,
    row.kind,
    row.customerCategory ?? null,
    row.saleType ?? null,
    row.previousValue,
    row.newValue,
    row.effectiveDate,
    row.note?.trim() || null,
    row.userId ?? null,
    nowIso(),
  );
}

export function upsertPrice(
  db: Db,
  input: UpsertPriceInput,
  userId?: string,
): PriceListItem {
  assertFound(
    db.prepare("SELECT id FROM products WHERE id = ?").get(input.productId),
    "Producto no encontrado",
  );

  const existing = db
    .prepare(
      `SELECT id, price FROM price_list
       WHERE product_id = ? AND customer_category = ? AND sale_type = ?`,
    )
    .get(input.productId, input.customerCategory, input.saleType) as
    | { id: string; price: number }
    | undefined;

  const effectiveDate = input.effectiveDate || todayLocalDate();
  const previous = existing ? Number(existing.price) : null;

  let resultId: string;
  if (existing) {
    db.prepare("UPDATE price_list SET price = ? WHERE id = ?").run(
      input.price,
      existing.id,
    );
    resultId = existing.id;
  } else {
    resultId = newId("prc");
    db.prepare(
      `INSERT INTO price_list (id, product_id, customer_category, sale_type, price)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      resultId,
      input.productId,
      input.customerCategory,
      input.saleType,
      input.price,
    );
  }

  if (previous === null || previous !== input.price) {
    insertPriceCostHistory(db, {
      productId: input.productId,
      kind: "price",
      customerCategory: input.customerCategory,
      saleType: input.saleType,
      previousValue: previous,
      newValue: input.price,
      effectiveDate,
      note: input.note,
      userId,
    });
  }

  return mapPrice(
    db.prepare("SELECT * FROM price_list WHERE id = ?").get(resultId) as Record<
      string,
      unknown
    >,
  );
}

/** Actualiza el costo original del producto y deja historial por día. */
export function upsertProductCost(
  db: Db,
  userId: string,
  input: UpsertProductCostInput,
): Product {
  const current = assertFound(
    db.prepare("SELECT * FROM products WHERE id = ?").get(input.productId) as
      | Record<string, unknown>
      | undefined,
    "Producto no encontrado",
  );
  const previous =
    current.cost == null || current.cost === ""
      ? null
      : Number(current.cost);
  const effectiveDate = input.effectiveDate || todayLocalDate();

  db.prepare("UPDATE products SET cost = ? WHERE id = ?").run(
    input.cost,
    input.productId,
  );

  if (previous === null || previous !== input.cost) {
    insertPriceCostHistory(db, {
      productId: input.productId,
      kind: "cost",
      previousValue: previous,
      newValue: input.cost,
      effectiveDate,
      note: input.note,
      userId,
    });
  }

  return mapProduct(
    db.prepare("SELECT * FROM products WHERE id = ?").get(input.productId) as Record<
      string,
      unknown
    >,
  );
}

export function listPriceCostHistory(
  db: Db,
  filters: {
    productId?: string;
    brand?: string;
    from?: string;
    to?: string;
    kind?: "cost" | "price";
    limit?: number;
  } = {},
): PriceCostHistory[] {
  const clauses: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (filters.productId) {
    clauses.push("h.product_id = ?");
    params.push(filters.productId);
  }
  if (filters.brand) {
    clauses.push("IFNULL(p.brand, '') = ?");
    params.push(filters.brand);
  }
  if (filters.from) {
    clauses.push("h.effective_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("h.effective_date <= ?");
    params.push(filters.to);
  }
  if (filters.kind) {
    clauses.push("h.kind = ?");
    params.push(filters.kind);
  }
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  params.push(limit);

  return (
    db
      .prepare(
        `SELECT h.*, p.code AS product_code, p.name AS product_name,
                p.brand AS brand, u.full_name AS employee_name
         FROM price_cost_history h
         JOIN products p ON p.id = h.product_id
         LEFT JOIN users u ON u.id = h.user_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY h.effective_date DESC, h.created_at DESC
         LIMIT ?`,
      )
      .all(...params) as Record<string, unknown>[]
  ).map((row) => ({
    id: String(row.id),
    productId: String(row.product_id),
    productCode: row.product_code == null ? null : String(row.product_code),
    productName: String(row.product_name),
    brand: row.brand == null ? null : String(row.brand),
    kind: row.kind as "cost" | "price",
    customerCategory:
      row.customer_category == null
        ? null
        : (String(row.customer_category) as CustomerCategory),
    saleType:
      row.sale_type == null ? null : (String(row.sale_type) as SaleType),
    previousValue:
      row.previous_value == null ? null : Number(row.previous_value),
    newValue: Number(row.new_value),
    effectiveDate: String(row.effective_date),
    note: row.note == null ? null : String(row.note),
    employeeName:
      row.employee_name == null ? null : String(row.employee_name),
    createdAt: String(row.created_at),
  }));
}

/** Matriz de precios + costo + margen; general o filtrada por marca. */
export function pricesOverview(
  db: Db,
  filters: { brand?: string; q?: string } = {},
): {
  brands: string[];
  products: {
    id: string;
    code: string | null;
    name: string;
    brand: string | null;
    category: string | null;
    cost: number | null;
    prices: {
      customerCategory: CustomerCategory;
      saleType: SaleType;
      price: number;
      margin: number | null;
    }[];
  }[];
} {
  const brands = (
    db
      .prepare(
        `SELECT DISTINCT brand FROM products
         WHERE active = 1 AND brand IS NOT NULL AND brand != ''
         ORDER BY brand COLLATE NOCASE`,
      )
      .all() as { brand: string }[]
  ).map((row) => row.brand);

  const clauses = ["p.active = 1"];
  const params: unknown[] = [];
  if (filters.brand) {
    clauses.push("IFNULL(p.brand, '') = ?");
    params.push(filters.brand);
  }
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    clauses.push(
      "(p.name LIKE ? OR p.brand LIKE ? OR p.code LIKE ? OR p.sku LIKE ?)",
    );
    params.push(term, term, term, term);
  }

  const products = (
    db
      .prepare(
        `SELECT id, code, name, brand, category, cost
         FROM products p
         WHERE ${clauses.join(" AND ")}
         ORDER BY IFNULL(brand, '') COLLATE NOCASE, code, name COLLATE NOCASE
         LIMIT 500`,
      )
      .all(...params) as {
      id: string;
      code: string | null;
      name: string;
      brand: string | null;
      category: string | null;
      cost: number | null;
    }[]
  ).map((product) => {
    const cost = product.cost == null ? null : Number(product.cost);
    const prices = (
      db
        .prepare(
          `SELECT customer_category, sale_type, price
           FROM price_list WHERE product_id = ?
           ORDER BY customer_category, sale_type`,
        )
        .all(product.id) as {
        customer_category: CustomerCategory;
        sale_type: SaleType;
        price: number;
      }[]
    ).map((row) => {
      const price = Number(row.price);
      return {
        customerCategory: row.customer_category,
        saleType: row.sale_type,
        price,
        margin: cost == null ? null : Math.round((price - cost) * 100) / 100,
      };
    });
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      brand: product.brand,
      category: product.category,
      cost,
      prices,
    };
  });

  return { brands, products };
}

export function resolvePrice(
  db: Db,
  productId: string,
  customerCategory: CustomerCategory,
  saleType: SaleType,
): number {
  const row = db
    .prepare(
      `SELECT price FROM price_list
       WHERE product_id = ? AND customer_category = ? AND sale_type = ?`,
    )
    .get(productId, customerCategory, saleType) as { price: number } | undefined;

  if (!row) {
    throw new AppError(
      "No hay precio configurado para este producto/categoría/tipo",
      400,
      "NO_PRICE",
    );
  }
  return Number(row.price);
}

export async function createUser(
  db: Db,
  input: CreateUserInput,
): Promise<User> {
  if (!input.storeId?.trim()) {
    throw new AppError(
      input.role === "Empleado"
        ? "El empleado debe estar atado a una sucursal"
        : "Elige una sucursal base para la cuenta",
      400,
    );
  }
  assertFound(
    db.prepare("SELECT id FROM stores WHERE id = ?").get(input.storeId),
    "Sucursal no encontrada",
  );
  const id = newId("usr");
  const passwordHash = await hashPassword(input.password);
  try {
    db.prepare(
      `INSERT INTO users (id, store_id, role, username, password_hash, full_name, phone, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      input.storeId,
      input.role,
      input.username,
      passwordHash,
      input.fullName,
      input.phone.trim(),
      nowIso(),
    );
  } catch {
    throw new AppError("Usuario ya existe", 409, "DUPLICATE");
  }
  return mapUser(
    db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
}

export function deactivateUser(db: Db, id: string, actorId: string): User {
  if (id === actorId) {
    throw new AppError("No puedes borrar tu propia cuenta", 400);
  }
  const row = assertFound(
    db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined,
    "Usuario no encontrado",
  );
  if (Number(row.active) !== 1) {
    throw new AppError("Ese usuario ya está dado de baja", 409);
  }
  if (String(row.role) === "Admin") {
    const admins = db
      .prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'Admin' AND active = 1",
      )
      .get() as { c: number };
    if (admins.c <= 1) {
      throw new AppError("Debe quedar al menos un administrador activo", 400);
    }
  }
  db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(id);
  return mapUser(
    db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
}

export function listUsers(db: Db): User[] {
  return (
    db.prepare("SELECT * FROM users ORDER BY full_name").all() as Record<
      string,
      unknown
    >[]
  ).map(mapUser);
}

export function listStores(db: Db) {
  return (
    db.prepare("SELECT * FROM stores ORDER BY code").all() as Record<
      string,
      unknown
    >[]
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    code: String(r.code),
    createdAt: String(r.created_at),
  }));
}

export function listPromotions(db: Db): Promotion[] {
  return (
    db.prepare("SELECT * FROM promotions ORDER BY starts_at DESC").all() as Record<
      string,
      unknown
    >[]
  ).map(mapPromotion);
}

export function createPromotion(
  db: Db,
  input: CreatePromotionInput,
): Promotion {
  if (input.type === "PercentOff" && input.percentOff == null) {
    throw new AppError("percentOff requerido", 400);
  }
  if (
    input.type === "BuyXGetY" &&
    (input.buyQty == null || input.getQty == null)
  ) {
    throw new AppError("buyQty y getQty requeridos", 400);
  }

  const id = newId("prm");
  db.prepare(
    `INSERT INTO promotions
     (id, name, type, active, starts_at, ends_at, percent_off, buy_qty, get_qty, product_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.type,
    boolToInt(input.active ?? true),
    input.startsAt,
    input.endsAt,
    input.percentOff ?? null,
    input.buyQty ?? null,
    input.getQty ?? null,
    input.productId ?? null,
    nowIso(),
  );

  return mapPromotion(
    db.prepare("SELECT * FROM promotions WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
}

export function setPromotionActive(
  db: Db,
  id: string,
  active: boolean,
): Promotion {
  assertFound(
    db.prepare("SELECT id FROM promotions WHERE id = ?").get(id),
    "Promoción no encontrada",
  );
  db.prepare("UPDATE promotions SET active = ? WHERE id = ?").run(
    boolToInt(active),
    id,
  );
  return mapPromotion(
    db.prepare("SELECT * FROM promotions WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
}
