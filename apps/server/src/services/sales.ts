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
import { printTicket, type TicketData } from "./print.js";

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
      if (quantityForProduct >= cycle) {
        const freeUnits = Math.floor(quantityForProduct / cycle) * promo.getQty;
        // Approximate per-line share of free units
        const d = freeUnits > 0 ? unitPrice * (promo.getQty / quantityForProduct) : 0;
        if (d > bestDiscount) {
          bestDiscount = d;
          name = promo.name;
        }
      }
    }
  }

  return {
    discount: Math.round(bestDiscount * 100) / 100,
    promotionName: name,
  };
}

export function previewSale(
  db: Db,
  input: Omit<CommitSaleInput, "printTicket">,
): { lines: ResolvedCartLine[]; subtotal: number; discountTotal: number; total: number } {
  const counts = new Map<string, number>();
  for (const barcode of input.barcodes) {
    const lot = db
      .prepare(
        `SELECT l.*, p.name AS product_name FROM lots l
         JOIN products p ON p.id = l.product_id WHERE l.barcode = ?`,
      )
      .get(barcode.trim()) as Record<string, unknown> | undefined;
    const found = assertFound(lot, `Lote no encontrado: ${barcode}`);
    if (String(found.status) !== "Disponible") {
      throw new AppError(`Lote ya vendido: ${barcode}`, 409, "LOT_SOLD");
    }
    if (String(found.store_id) !== input.storeId) {
      throw new AppError(
        `Lote no pertenece a esta sucursal: ${barcode}`,
        400,
        "WRONG_STORE",
      );
    }
    const pid = String(found.product_id);
    counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }

  const lines: ResolvedCartLine[] = [];
  let subtotal = 0;
  let discountTotal = 0;

  for (const barcode of input.barcodes) {
    const lot = db
      .prepare(
        `SELECT l.*, p.name AS product_name FROM lots l
         JOIN products p ON p.id = l.product_id WHERE l.barcode = ?`,
      )
      .get(barcode.trim()) as Record<string, unknown>;

    const productId = String(lot.product_id);
    const unitPrice = resolvePrice(
      db,
      productId,
      input.customerCategory,
      input.saleType,
    );
    const promos = activePromotions(db, productId);
    const { discount, promotionName } = applyPromotions(
      unitPrice,
      promos,
      counts.get(productId) ?? 1,
    );
    const finalPrice = Math.round((unitPrice - discount) * 100) / 100;
    subtotal += unitPrice;
    discountTotal += discount;
    lines.push({
      lotId: String(lot.id),
      barcode: String(lot.barcode),
      productId,
      productName: String(lot.product_name),
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
): Promise<{ sale: Sale; items: SaleItem[]; ticketText: string }> {
  if (input.customerId) {
    assertFound(
      db.prepare("SELECT id FROM customers WHERE id = ?").get(input.customerId),
      "Cliente no encontrado",
    );
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
    lines: preview.lines.map((l) => ({
      name: l.productName,
      barcode: l.barcode,
      price: l.finalPrice,
    })),
    subtotal: preview.subtotal,
    discountTotal: preview.discountTotal,
    total: preview.total,
  };

  // Print first; only commit if print succeeds (regla dura del plan)
  let ticketText: string;
  if (input.printTicket !== false) {
    const printed = await printTicket(ticketData);
    if (!printed.ok) {
      throw new AppError(
        `No se pudo imprimir el ticket: ${printed.error}. La venta no se cerró.`,
        502,
        "PRINT_FAILED",
      );
    }
    ticketText = printed.text;
  } else {
    throw new AppError(
      "La venta no se cierra sin imprimir ticket",
      400,
      "TICKET_REQUIRED",
    );
  }

  const tx = db.transaction(() => {
    // Re-check lots inside transaction
    for (const line of preview.lines) {
      const lot = db
        .prepare("SELECT status FROM lots WHERE id = ?")
        .get(line.lotId) as { status: string } | undefined;
      if (!lot || lot.status !== "Disponible") {
        throw new AppError(
          `Lote no disponible: ${line.barcode}`,
          409,
          "LOT_SOLD",
        );
      }
    }

    db.prepare(
      `INSERT INTO sales
       (id, folio, store_id, user_id, customer_id, sale_type, customer_category,
        payment_method, subtotal, discount_total, total, ticket_printed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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

  return { sale, items, ticketText };
}
