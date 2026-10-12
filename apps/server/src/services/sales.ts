import { newId, nowIso, type Db } from "@lcds/db";
import type {
  CommitSaleInput,
  Promotion,
  ResolvedCartLine,
  Sale,
  SaleItem,
} from "@lcds/shared";
import { AppError, assertFound } from "../errors.js";
import { mapPromotion, mapSale, mapSaleItem } from "../mappers.js";
import { resolvePrice } from "./catalog.js";
import { formatTicket } from "./print.js";
import { deliverTicket, type TicketData } from "./ticket-delivery.js";

function activePromotions(db: Db, productId: string): Promotion[] {
  const now = nowIso();
  const rows = db
    .prepare(
      `SELECT * FROM promotions
       WHERE active = 1 AND starts_at <= ? AND ends_at >= ?
         AND (product_id IS NULL OR product_id = ?)`,
    )
    .all(now, now, productId) as Record<string, unknown>[];
  return rows.map(mapPromotion);
}

function applyPromotions(
  unitPrice: number,
  promotions: Promotion[],
  quantityForProduct: number,
  lineIndex: number,
): { discount: number; promotionName: string | null } {
  let bestDiscount = 0;
  let name: string | null = null;

  for (const promo of promotions) {
    if (promo.type === "PercentOff" && promo.percentOff != null) {
      const d = (unitPrice * promo.percentOff) / 100;
      if (d > bestDiscount) {
        bestDiscount = d;
        name = promo.name;
      }
    }
    if (
      promo.type === "BuyXGetY" &&
      promo.buyQty != null &&
      promo.getQty != null
    ) {
      const cycle = promo.buyQty + promo.getQty;
      if (cycle > 0 && quantityForProduct >= cycle) {
        const freeUnits = Math.min(
          quantityForProduct,
          Math.floor(quantityForProduct / cycle) * promo.getQty,
        );
        const cents = Math.round(freeUnits * unitPrice * 100);
        const base = Math.floor(cents / quantityForProduct);
        const extra = cents % quantityForProduct;
        const d = (base + (lineIndex < extra ? 1 : 0)) / 100;
        if (d > bestDiscount) {
          bestDiscount = d;
          name = promo.name;
        }
      }
    }
  }

  const discount = Math.min(unitPrice, Math.round(bestDiscount * 100) / 100);
  return {
    discount,
    promotionName: discount > 0 ? name : null,
  };
}

type ScannedUnit = {
  lotId: string;
  barcode: string;
  productId: string;
  productName: string;
};

function resolveScans(
  db: Db,
  barcodes: string[],
  storeId: string,
): ScannedUnit[] {
  const used = new Set<string>();
  return barcodes.map((raw) => takeUnit(db, raw.trim(), storeId, used));
}

function takeUnit(
  db: Db,
  scanned: string,
  storeId: string,
  used: Set<string>,
): ScannedUnit {
  const exact = db
    .prepare(
      `SELECT l.id, l.barcode, l.product_id, l.store_id, l.status, p.name AS product_name
       FROM lots l
       JOIN products p ON p.id = l.product_id
       WHERE l.barcode = ?`,
    )
    .get(scanned) as
    | {
        id: string;
        barcode: string;
        product_id: string;
        store_id: string;
        status: string;
        product_name: string;
      }
    | undefined;

  if (exact) {
    if (used.has(exact.id)) {
      throw new AppError(`Esa pieza ya está en el ticket: ${scanned}`, 409, "LOT_SOLD");
    }
    if (exact.status !== "Disponible") {
      throw new AppError(`Lote ya vendido: ${scanned}`, 409, "LOT_SOLD");
    }
    if (exact.store_id !== storeId) {
      throw new AppError(
        `Lote no pertenece a esta sucursal: ${scanned}`,
        400,
        "WRONG_STORE",
      );
    }
    used.add(exact.id);
    return {
      lotId: exact.id,
      barcode: exact.barcode,
      productId: exact.product_id,
      productName: exact.product_name,
    };
  }

  const product = db
    .prepare(
      `SELECT id, name, code
       FROM products
       WHERE upper(code) = upper(?)
          OR upper(IFNULL(barcode, '')) = upper(?)`,
    )
    .get(scanned, scanned) as
    | { id: string; name: string; code: string | null }
    | undefined;

  if (!product) {
    throw new AppError(`Producto no encontrado: ${scanned}`, 404, "NOT_FOUND");
  }

  const available = db
    .prepare(
      `SELECT id FROM lots
       WHERE product_id = ? AND store_id = ? AND status = 'Disponible'
       ORDER BY created_at, id`,
    )
    .all(product.id, storeId) as { id: string }[];
  const lot = available.find((item) => !used.has(item.id));
  if (!lot) {
    throw new AppError(
      `No hay stock de ${product.name} en esta sucursal`,
      409,
      "OUT_OF_STOCK",
    );
  }
  used.add(lot.id);
  return {
    lotId: lot.id,
    barcode: product.code ?? scanned,
    productId: product.id,
    productName: product.name,
  };
}

export function previewSale(
  db: Db,
  input: Omit<CommitSaleInput, "printTicket" | "email">,
): { lines: ResolvedCartLine[]; subtotal: number; discountTotal: number; total: number } {
  const units = resolveScans(db, input.barcodes, input.storeId);
  const counts = new Map<string, number>();
  for (const unit of units) {
    counts.set(unit.productId, (counts.get(unit.productId) ?? 0) + 1);
  }

  const lines: ResolvedCartLine[] = [];
  let subtotal = 0;
  let discountTotal = 0;
  const seen = new Map<string, number>();

  for (const unit of units) {
    const unitPrice = resolvePrice(
      db,
      unit.productId,
      input.customerCategory,
      input.saleType,
    );
    const lineIndex = seen.get(unit.productId) ?? 0;
    seen.set(unit.productId, lineIndex + 1);
    const promos = activePromotions(db, unit.productId);
    const { discount, promotionName } = applyPromotions(
      unitPrice,
      promos,
      counts.get(unit.productId) ?? 1,
      lineIndex,
    );
    const finalPrice = Math.round((unitPrice - discount) * 100) / 100;
    subtotal += unitPrice;
    discountTotal += discount;
    lines.push({
      lotId: unit.lotId,
      barcode: unit.barcode,
      productId: unit.productId,
      productName: unit.productName,
      unitPrice,
      discount,
      finalPrice,
      promotionName,
    });
  }

  return {
    lines,
    subtotal: Math.round(subtotal * 100) / 100,
    discountTotal: Math.round(discountTotal * 100) / 100,
    total: Math.round((subtotal - discountTotal) * 100) / 100,
  };
}

function nextFolio(db: Db, storeId: string): string {
  const store = assertFound(
    db.prepare("SELECT code FROM stores WHERE id = ?").get(storeId) as
      | { code: string }
      | undefined,
    "Sucursal no encontrada",
  );
  const count = (
    db
      .prepare("SELECT COUNT(*) AS c FROM sales WHERE store_id = ?")
      .get(storeId) as { c: number }
  ).c;
  return `${store.code}-${String(count + 1).padStart(6, "0")}`;
}

export async function commitSale(
  db: Db,
  userId: string,
  input: CommitSaleInput,
): Promise<{
  sale: Sale;
  items: SaleItem[];
  ticketText: string;
  emailed: boolean;
  email: string;
}> {
  if (input.customerId) {
    const customer = assertFound(
      db
        .prepare("SELECT id, store_id, category FROM customers WHERE id = ?")
        .get(input.customerId) as
        | { id: string; store_id: string | null; category: string }
        | undefined,
      "Cliente no encontrado",
    );
    if (customer.store_id && customer.store_id !== input.storeId) {
      throw new AppError("Ese cliente no pertenece a esta sucursal", 400);
    }
    if (customer.category !== input.customerCategory) {
      throw new AppError(
        "El cliente no corresponde a la categoría de la venta",
        400,
      );
    }
  }

  const preview = previewSale(db, input);
  const saleId = newId("sal");
  const folio = nextFolio(db, input.storeId);
  const createdAt = nowIso();

  const store = assertFound(
    db.prepare("SELECT * FROM stores WHERE id = ?").get(input.storeId) as
      | Record<string, unknown>
      | undefined,
    "Sucursal no encontrada",
  );
  const user = assertFound(
    db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
      | Record<string, unknown>
      | undefined,
    "Usuario no encontrado",
  );
  const customerName = input.customerId
    ? (
        db
          .prepare("SELECT name FROM customers WHERE id = ?")
          .get(input.customerId) as { name: string } | undefined
      )?.name ?? null
    : null;

  const ticketData: TicketData = {
    storeName: String(store.name),
    storeCode: String(store.code),
    folio,
    date: createdAt,
    employee: String(user.full_name),
    customer: customerName,
    saleType: input.saleType,
    customerCategory: input.customerCategory,
    paymentMethod: input.paymentMethod ?? null,
    email: input.email,
    lines: preview.lines.map((l) => ({
      name: l.productName,
      barcode: l.barcode,
      price: l.finalPrice,
    })),
    subtotal: preview.subtotal,
    discountTotal: preview.discountTotal,
    total: preview.total,
  };

  const delivered = await deliverTicket(ticketData, input.email);
  if (!delivered.ok) {
    throw new AppError(
      `No se pudo enviar el ticket: ${delivered.error}. La venta no se cerró.`,
      502,
      "EMAIL_FAILED",
    );
  }
  const ticketText = delivered.text;

  const tx = db.transaction(() => {
    const used = new Set<string>();
    for (const line of preview.lines) {
      const current = db
        .prepare("SELECT status FROM lots WHERE id = ?")
        .get(line.lotId) as { status: string } | undefined;
      if (!current || current.status !== "Disponible" || used.has(line.lotId)) {
        const available = db
          .prepare(
            `SELECT id FROM lots
             WHERE product_id = ? AND store_id = ? AND status = 'Disponible'
             ORDER BY created_at, id`,
          )
          .all(line.productId, input.storeId) as { id: string }[];
        const replacement = available.find((item) => !used.has(item.id));
        if (!replacement) {
          throw new AppError(
            `No hay stock de ${line.productName} en esta sucursal`,
            409,
            "OUT_OF_STOCK",
          );
        }
        line.lotId = replacement.id;
      }
      used.add(line.lotId);
    }

    db.prepare(
      `INSERT INTO sales
       (id, folio, store_id, user_id, customer_id, sale_type, customer_category,
        payment_method, subtotal, discount_total, total, ticket_printed,
        ticket_email, ticket_emailed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run(
      saleId,
      folio,
      input.storeId,
      userId,
      input.customerId ?? null,
      input.saleType,
      input.customerCategory,
      input.paymentMethod ?? null,
      preview.subtotal,
      preview.discountTotal,
      preview.total,
      input.email,
      delivered.emailed ? 1 : 0,
      createdAt,
    );

    for (const line of preview.lines) {
      const itemId = newId("sit");
      db.prepare(
        `INSERT INTO sale_items
         (id, sale_id, lot_id, product_id, barcode, product_name, unit_price, discount, final_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        itemId,
        saleId,
        line.lotId,
        line.productId,
        line.barcode,
        line.productName,
        line.unitPrice,
        line.discount,
        line.finalPrice,
      );
      db.prepare(
        `UPDATE lots SET status = 'Vendido', sold_at = ? WHERE id = ? AND status = 'Disponible'`,
      ).run(createdAt, line.lotId);
    }
  });

  try {
    tx();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      err instanceof Error ? err.message : "Error al registrar venta",
      500,
    );
  }

  const sale = mapSale(
    db.prepare("SELECT * FROM sales WHERE id = ?").get(saleId) as Record<
      string,
      unknown
    >,
  );
  const items = (
    db
      .prepare("SELECT * FROM sale_items WHERE sale_id = ?")
      .all(saleId) as Record<string, unknown>[]
  ).map(mapSaleItem);

  return {
    sale,
    items,
    ticketText,
    emailed: delivered.emailed,
    email: input.email,
  };
}

export type RecentTicket = {
  folio: string;
  createdAt: string;
  total: number;
  email: string | null;
  emailed: boolean;
  storeName: string;
  ticketText: string;
};

export function listRecentTickets(
  db: Db,
  storeId: string,
  limit = 5,
): RecentTicket[] {
  const sales = db
    .prepare(
      `SELECT s.id, s.folio, s.created_at, s.subtotal, s.discount_total, s.total,
              s.ticket_email, s.ticket_emailed,
              s.sale_type, s.customer_category, s.payment_method,
              st.name AS store_name, st.code AS store_code,
              u.full_name AS employee,
              c.name AS customer_name
       FROM sales s
       JOIN stores st ON st.id = s.store_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.store_id = ? AND s.ticket_printed = 1
       ORDER BY s.created_at DESC
       LIMIT ?`,
    )
    .all(storeId, limit) as Record<string, unknown>[];

  const itemsStmt = db.prepare(
    `SELECT product_name, barcode, final_price
     FROM sale_items WHERE sale_id = ? ORDER BY rowid`,
  );

  return sales.map((row) => {
    const items = itemsStmt.all(String(row.id)) as {
      product_name: string;
      barcode: string;
      final_price: number;
    }[];
    const email = row.ticket_email == null ? null : String(row.ticket_email);
    return {
      folio: String(row.folio),
      createdAt: String(row.created_at),
      total: Number(row.total),
      email,
      emailed: Number(row.ticket_emailed) === 1,
      storeName: String(row.store_name),
      ticketText: formatTicket({
        storeName: String(row.store_name),
        storeCode: String(row.store_code),
        folio: String(row.folio),
        date: String(row.created_at),
        employee: String(row.employee),
        customer: row.customer_name == null ? null : String(row.customer_name),
        saleType: String(row.sale_type),
        customerCategory: String(row.customer_category),
        paymentMethod:
          row.payment_method == null ? null : String(row.payment_method),
        email,
        lines: items.map((item) => ({
          name: item.product_name,
          barcode: item.barcode,
          price: Number(item.final_price),
        })),
        subtotal: Number(row.subtotal),
        discountTotal: Number(row.discount_total),
        total: Number(row.total),
      }),
    };
  });
}
