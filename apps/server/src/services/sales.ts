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
import {
  deliverTicketDelivery,
  normalizePhone,
  sendHqNotification,
  type TicketData,
} from "./ticket-delivery.js";

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
  input: Omit<CommitSaleInput, "printTicket" | "email" | "phone" | "deliveryChannel">,
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
  const costs = new Map<string, number | null>();

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
    let unitCost = costs.get(unit.productId);
    if (unitCost === undefined) {
      const costRow = db
        .prepare("SELECT cost FROM products WHERE id = ?")
        .get(unit.productId) as { cost: number | null } | undefined;
      unitCost = costRow?.cost == null ? null : Number(costRow.cost);
      costs.set(unit.productId, unitCost);
    }
    lines.push({
      lotId: unit.lotId,
      barcode: unit.barcode,
      productId: unit.productId,
      productName: unit.productName,
      unitPrice,
      unitCost,
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
  channel: "email" | "whatsapp" | "none";
  destination: string;
  delivered: boolean;
  whatsappUrl?: string;
  hqNotified: boolean;
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

  const channel = input.deliveryChannel ?? "none";
  const email = channel === "email" ? (input.email ?? "").trim() : "";
  const phone = channel === "whatsapp" ? normalizePhone(input.phone ?? "") : "";

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
    email: email || null,
    phone: phone || null,
    lines: preview.lines.map((l) => ({
      name: l.productName,
      barcode: l.barcode,
      price: l.finalPrice,
    })),
    subtotal: preview.subtotal,
    discountTotal: preview.discountTotal,
    total: preview.total,
  };

  const delivered = await deliverTicketDelivery(ticketData, {
    channel,
    email,
    phone,
  });
  if (channel !== "none" && !delivered.ok) {
    throw new AppError(
      `No se pudo enviar el ticket: ${delivered.error}. La venta no se cerró.`,
      502,
      channel === "whatsapp" ? "WHATSAPP_FAILED" : "EMAIL_FAILED",
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
        ticket_email, ticket_emailed, ticket_phone, ticket_channel, ticket_whatsapped,
        notify_hq, hq_emailed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?)`,
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
      email || null,
      channel === "email" && delivered.sent ? 1 : 0,
      phone || null,
      channel,
      channel === "whatsapp" && delivered.sent ? 1 : 0,
      input.notifyHq ? 1 : 0,
      createdAt,
    );

    for (const line of preview.lines) {
      const itemId = newId("sit");
      db.prepare(
        `INSERT INTO sale_items
         (id, sale_id, lot_id, product_id, barcode, product_name, unit_price, unit_cost, discount, final_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        itemId,
        saleId,
        line.lotId,
        line.productId,
        line.barcode,
        line.productName,
        line.unitPrice,
        line.unitCost ?? null,
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

  // Aviso a oficina: una sola vez y sin romper la venta si falla.
  let hqNotified = false;
  if (input.notifyHq) {
    try {
      const pending = db
        .prepare("SELECT hq_emailed FROM sales WHERE id = ?")
        .get(saleId) as { hq_emailed: number } | undefined;
      if (pending && Number(pending.hq_emailed) !== 1) {
        const result = await sendHqNotification({
          folio,
          date: createdAt,
          storeName: String(store.name),
          storeCode: String(store.code),
          employee: String(user.full_name),
          customer: customerName,
          saleType: input.saleType,
          customerCategory: input.customerCategory,
          paymentMethod: input.paymentMethod ?? null,
          lines: preview.lines.map((l) => ({
            name: l.productName,
            barcode: l.barcode,
            price: l.finalPrice,
          })),
          subtotal: preview.subtotal,
          discountTotal: preview.discountTotal,
          total: preview.total,
        });
        if (result.sent) {
          db.prepare(
            "UPDATE sales SET hq_emailed = 1 WHERE id = ? AND hq_emailed = 0",
          ).run(saleId);
          hqNotified = true;
        }
      } else if (pending) {
        hqNotified = true;
      }
    } catch (err) {
      console.error(
        `[hq] No se pudo avisar a oficina de la venta ${folio}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    sale,
    items,
    ticketText,
    emailed: channel === "email" && delivered.sent,
    email,
    channel,
    destination: delivered.destination,
    delivered: delivered.sent,
    whatsappUrl: delivered.whatsappUrl,
    hqNotified,
  };
}

export type SaleHistoryFilters = {
  storeId?: string;
  userId?: string;
  customerId?: string;
  productId?: string;
  from?: string;
  to?: string;
  paymentMethod?: string;
  customerCategory?: string;
  saleType?: string;
};

export type SaleHistoryViewer = { id: string; role: string };

export type SaleHistoryEntry = Sale & {
  employeeName: string;
  customerName: string | null;
  storeName: string;
  storeCode: string;
  hqEmailed: boolean;
  ticketPhone: string | null;
  ticketChannel: "email" | "whatsapp" | "none" | null;
  items: SaleItem[];
};

const SALE_HISTORY_SELECT = `
  SELECT s.*, u.full_name AS employee_name, c.name AS customer_name,
         st.name AS store_name, st.code AS store_code
  FROM sales s
  JOIN users u ON u.id = s.user_id
  JOIN stores st ON st.id = s.store_id
  LEFT JOIN customers c ON c.id = s.customer_id`;

function hydrateSales(
  db: Db,
  rows: Record<string, unknown>[],
  viewer?: SaleHistoryViewer,
): SaleHistoryEntry[] {
  const itemsStmt = db.prepare(
    "SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid",
  );
  const hideCost = viewer?.role === "Empleado";
  return rows.map((row) => {
    const items = (itemsStmt.all(String(row.id)) as Record<string, unknown>[])
      .map(mapSaleItem)
      .map((item) => (hideCost ? { ...item, unitCost: null } : item));
    const channel =
      row.ticket_channel === "whatsapp" ||
      row.ticket_channel === "email" ||
      row.ticket_channel === "none"
        ? row.ticket_channel
        : null;
    return {
      ...mapSale(row),
      employeeName: String(row.employee_name),
      customerName: row.customer_name == null ? null : String(row.customer_name),
      storeName: String(row.store_name),
      storeCode: String(row.store_code),
      hqEmailed: Number(row.hq_emailed ?? 0) === 1,
      ticketPhone:
        row.ticket_phone == null || row.ticket_phone === ""
          ? null
          : String(row.ticket_phone),
      ticketChannel: channel,
      items,
    };
  });
}

/** Historial de ventas con productos. Un empleado solo ve sus propias ventas. */
export function listSalesHistory(
  db: Db,
  filters: SaleHistoryFilters = {},
  options: { limit?: number; offset?: number; viewer?: SaleHistoryViewer } = {},
): { sales: SaleHistoryEntry[]; total: number; limit: number; offset: number } {
  const effective: SaleHistoryFilters = { ...filters };
  if (options.viewer?.role === "Empleado") {
    effective.userId = options.viewer.id;
  }

  const clauses: string[] = ["s.ticket_printed = 1"];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    clauses.push(sql);
    params.push(value);
  };
  if (effective.storeId) add("s.store_id = ?", effective.storeId);
  if (effective.userId) add("s.user_id = ?", effective.userId);
  if (effective.customerId) add("s.customer_id = ?", effective.customerId);
  if (effective.from) add("s.created_at >= ?", effective.from);
  if (effective.to) add("s.created_at <= ?", effective.to);
  if (effective.paymentMethod) add("s.payment_method = ?", effective.paymentMethod);
  if (effective.customerCategory) {
    add("s.customer_category = ?", effective.customerCategory);
  }
  if (effective.saleType) add("s.sale_type = ?", effective.saleType);
  if (effective.productId) {
    add(
      "EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = ?)",
      effective.productId,
    );
  }
  const where = `WHERE ${clauses.join(" AND ")}`;

  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM sales s ${where}`)
      .get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `${SALE_HISTORY_SELECT}
       ${where}
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  return { sales: hydrateSales(db, rows, options.viewer), total, limit, offset };
}

/** Detalle de una venta (con ticket). Un empleado solo puede ver las propias. */
export function getSaleDetail(
  db: Db,
  saleId: string,
  viewer?: SaleHistoryViewer,
): SaleHistoryEntry & { ticketText: string } {
  const row = assertFound(
    db
      .prepare(`${SALE_HISTORY_SELECT} WHERE s.id = ?`)
      .get(saleId) as Record<string, unknown> | undefined,
    "Venta no encontrada",
  );
  if (viewer?.role === "Empleado" && String(row.user_id) !== viewer.id) {
    throw new AppError("Solo puede ver sus propias ventas", 403, "FORBIDDEN");
  }
  const [sale] = hydrateSales(db, [row], viewer);
  return {
    ...sale,
    ticketText: formatTicket({
      storeName: sale.storeName,
      storeCode: sale.storeCode,
      folio: sale.folio,
      date: sale.createdAt,
      employee: sale.employeeName,
      customer: sale.customerName,
      saleType: sale.saleType,
      customerCategory: sale.customerCategory,
      paymentMethod: sale.paymentMethod,
      email: row.ticket_email == null ? null : String(row.ticket_email),
      phone: row.ticket_phone == null ? null : String(row.ticket_phone),
      lines: sale.items.map((item) => ({
        name: item.productName,
        barcode: item.barcode,
        price: item.finalPrice,
      })),
      subtotal: sale.subtotal,
      discountTotal: sale.discountTotal,
      total: sale.total,
    }),
  };
}

export type RecentTicket = {
  folio: string;
  createdAt: string;
  total: number;
  email: string | null;
  emailed: boolean;
  phone: string | null;
  channel: "email" | "whatsapp" | "none";
  delivered: boolean;
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
              s.ticket_email, s.ticket_emailed, s.ticket_phone, s.ticket_channel, s.ticket_whatsapped,
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
    const phone = row.ticket_phone == null ? null : String(row.ticket_phone);
    const channel: "email" | "whatsapp" | "none" =
      row.ticket_channel === "whatsapp"
        ? "whatsapp"
        : row.ticket_channel === "none"
          ? "none"
          : "email";
    const emailed = Number(row.ticket_emailed) === 1;
    return {
      folio: String(row.folio),
      createdAt: String(row.created_at),
      total: Number(row.total),
      email,
      emailed,
      phone,
      channel,
      delivered:
        channel === "whatsapp"
          ? Number(row.ticket_whatsapped) === 1
          : emailed,
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
        phone,
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
