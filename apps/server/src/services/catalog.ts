import { boolToInt, newId, nowIso, type Db } from "@lcds/db";
import type {
  CreateProductInput,
  CreateLotInput,
  CreateCustomerInput,
  UpsertPriceInput,
  CreateUserInput,
  CreatePromotionInput,
  Product,
  Lot,
  Customer,
  PriceListItem,
  User,
  Promotion,
  CustomerCategory,
  SaleType,
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
        `SELECT * FROM products ${where} ORDER BY category, brand, name LIMIT 2000`,
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

export function createProduct(db: Db, input: CreateProductInput): Product {
  const id = newId("prd");
  try {
    db.prepare(
      `INSERT INTO products (id, sku, name, brand, category, cost, description, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      input.sku,
      input.name,
      input.brand ?? null,
      input.category ?? null,
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

export function listCustomers(db: Db, storeId?: string): Customer[] {
  const rows = storeId
    ? (db
        .prepare(
          `SELECT * FROM customers
           WHERE active = 1 AND (store_id = ? OR store_id IS NULL)
           ORDER BY name`,
        )
        .all(storeId) as Record<string, unknown>[])
    : (db
        .prepare(
          "SELECT * FROM customers WHERE active = 1 ORDER BY name",
        )
        .all() as Record<string, unknown>[]);
  return rows.map(mapCustomer);
}

export function createCustomer(
  db: Db,
  input: CreateCustomerInput,
): Customer {
  assertFound(
    db.prepare("SELECT id FROM stores WHERE id = ?").get(input.storeId),
    "Sucursal no encontrada",
  );
  const id = newId("cus");
  db.prepare(
    `INSERT INTO customers (id, name, category, phone, store_id, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    id,
    input.name,
    input.category,
    input.phone ?? null,
    input.storeId,
    nowIso(),
  );
  return mapCustomer(
    db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
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

export function upsertPrice(db: Db, input: UpsertPriceInput): PriceListItem {
  assertFound(
    db.prepare("SELECT id FROM products WHERE id = ?").get(input.productId),
    "Producto no encontrado",
  );

  const existing = db
    .prepare(
      `SELECT id FROM price_list
       WHERE product_id = ? AND customer_category = ? AND sale_type = ?`,
    )
    .get(input.productId, input.customerCategory, input.saleType) as
    | { id: string }
    | undefined;

  if (existing) {
    db.prepare("UPDATE price_list SET price = ? WHERE id = ?").run(
      input.price,
      existing.id,
    );
    return mapPrice(
      db.prepare("SELECT * FROM price_list WHERE id = ?").get(existing.id) as Record<
        string,
        unknown
      >,
    );
  }

  const id = newId("prc");
  db.prepare(
    `INSERT INTO price_list (id, product_id, customer_category, sale_type, price)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.productId,
    input.customerCategory,
    input.saleType,
    input.price,
  );
  return mapPrice(
    db.prepare("SELECT * FROM price_list WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
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
  assertFound(
    db.prepare("SELECT id FROM stores WHERE id = ?").get(input.storeId),
    "Sucursal no encontrada",
  );
  const id = newId("usr");
  const passwordHash = await hashPassword(input.password);
  try {
    db.prepare(
      `INSERT INTO users (id, store_id, role, username, password_hash, full_name, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      input.storeId,
      input.role,
      input.username,
      passwordHash,
      input.fullName,
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
