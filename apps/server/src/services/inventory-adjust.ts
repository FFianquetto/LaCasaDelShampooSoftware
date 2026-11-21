import { newId, nowIso, type Db } from "@lcds/db";
import type { AdjustStockInput } from "@lcds/shared";
import { AppError, assertFound } from "../errors.js";

export type InventoryAdjustment = {
  id: string;
  productId: string;
  productName: string;
  productCode: string | null;
  storeId: string;
  storeName: string;
  storeCode: string;
  userId: string;
  employeeName: string;
  previousQty: number;
  newQty: number;
  delta: number;
  reason: string;
  createdAt: string;
};

function mapAdjustment(row: Record<string, unknown>): InventoryAdjustment {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    productCode: row.product_code == null ? null : String(row.product_code),
    storeId: String(row.store_id),
    storeName: String(row.store_name),
    storeCode: String(row.store_code),
    userId: String(row.user_id),
    employeeName: String(row.employee_name),
    previousQty: Number(row.previous_qty),
    newQty: Number(row.new_qty),
    delta: Number(row.delta),
    reason: String(row.reason),
    createdAt: String(row.created_at),
  };
}

const ADJUSTMENT_SELECT = `
  SELECT a.*, p.name AS product_name, p.code AS product_code,
         st.name AS store_name, st.code AS store_code, u.full_name AS employee_name
  FROM inventory_adjustments a
  JOIN products p ON p.id = a.product_id
  JOIN stores st ON st.id = a.store_id
  JOIN users u ON u.id = a.user_id`;

function availableCount(db: Db, productId: string, storeId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM lots
         WHERE product_id = ? AND store_id = ? AND status = 'Disponible'`,
      )
      .get(productId, storeId) as { c: number }
  ).c;
}

/**
 * Ajusta las existencias (lotes Disponibles) de un producto en una sucursal.
 * Los lotes Vendidos no se tocan; el historial queda en inventory_adjustments.
 */
export function adjustStock(
  db: Db,
  userId: string,
  input: AdjustStockInput,
): {
  adjustment: InventoryAdjustment | null;
  previousQty: number;
  newQty: number;
  delta: number;
  created: number;
  removed: number;
} {
  const product = assertFound(
    db.prepare("SELECT id, code, sku FROM products WHERE id = ?").get(
      input.productId,
    ) as { id: string; code: string | null; sku: string } | undefined,
    "Producto no encontrado",
  );
  assertFound(
    db.prepare("SELECT id FROM stores WHERE id = ?").get(input.storeId),
    "Sucursal no encontrada",
  );
  assertFound(
    db.prepare("SELECT id FROM users WHERE id = ?").get(userId),
    "Usuario no encontrado",
  );

  const reason = input.reason.trim();
  if (!reason) throw new AppError("Escribe el motivo del ajuste", 400);

  let result!: ReturnType<typeof adjustStock>;
  const tx = db.transaction(() => {
    const current = availableCount(db, input.productId, input.storeId);
    let target: number;
    if (input.mode === "set") target = input.quantity;
    else if (input.mode === "increase") target = current + input.quantity;
    else target = Math.max(0, current - input.quantity);

    const delta = target - current;
    if (delta === 0) {
      result = {
        adjustment: null,
        previousQty: current,
        newQty: current,
        delta: 0,
        created: 0,
        removed: 0,
      };
      return;
    }

    let created = 0;
    let removed = 0;

    if (delta > 0) {
      const base = (product.code || product.sku).trim();
      const stamp = Date.now();
      const exists = db.prepare("SELECT 1 FROM lots WHERE barcode = ?");
      const insert = db.prepare(
        `INSERT INTO lots (id, barcode, product_id, store_id, status, created_at)
         VALUES (?, ?, ?, ?, 'Disponible', ?)`,
      );
      for (let n = 1; n <= delta; n++) {
        let barcode = `${base}-A${stamp}-${n}`;
        let salt = 0;
        while (exists.get(barcode)) {
          salt += 1;
          barcode = `${base}-A${stamp}-${n}-${salt}`;
        }
        insert.run(newId("lot"), barcode, input.productId, input.storeId, nowIso());
        created += 1;
      }
    } else {
      const toRemove = -delta;
      const oldest = db
        .prepare(
          `SELECT id FROM lots
           WHERE product_id = ? AND store_id = ? AND status = 'Disponible'
           ORDER BY created_at, id
           LIMIT ?`,
        )
        .all(input.productId, input.storeId, toRemove) as { id: string }[];
      const del = db.prepare(
        "DELETE FROM lots WHERE id = ? AND status = 'Disponible'",
      );
      for (const lot of oldest) {
        removed += del.run(lot.id).changes;
      }
    }

    const id = newId("adj");
    db.prepare(
      `INSERT INTO inventory_adjustments
       (id, product_id, store_id, user_id, previous_qty, new_qty, delta, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.productId,
      input.storeId,
      userId,
      current,
      target,
      delta,
      reason,
      nowIso(),
    );

    const row = db
      .prepare(`${ADJUSTMENT_SELECT} WHERE a.id = ?`)
      .get(id) as Record<string, unknown>;
    result = {
      adjustment: mapAdjustment(row),
      previousQty: current,
      newQty: target,
      delta,
      created,
      removed,
    };
  });
  tx();
  return result;
}

export function listInventoryAdjustments(
  db: Db,
  filters: {
    productId?: string;
    storeId?: string;
    userId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
): InventoryAdjustment[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    clauses.push(sql);
    params.push(value);
  };
  if (filters.productId) add("a.product_id = ?", filters.productId);
  if (filters.storeId) add("a.store_id = ?", filters.storeId);
  if (filters.userId) add("a.user_id = ?", filters.userId);
  if (filters.from) add("a.created_at >= ?", filters.from);
  if (filters.to) add("a.created_at <= ?", filters.to);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 200), 1), 1000);
  const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);

  const rows = db
    .prepare(
      `${ADJUSTMENT_SELECT} ${where}
       ORDER BY a.created_at DESC, a.rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[];
  return rows.map(mapAdjustment);
}
