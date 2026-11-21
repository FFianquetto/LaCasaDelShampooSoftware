import { newId, nowIso, type Db } from "@lcds/db";
import type {
  CashCut,
  CashMovementInput,
  CloseCashCutInput,
  OpenCashCutInput,
} from "@lcds/shared";
import { AppError, assertFound } from "../errors.js";
import { mapCashCut } from "../mappers.js";

export type CashMovement = {
  id: string;
  cashCutId: string;
  storeId: string;
  userId: string;
  type: "Entrada" | "Salida" | "Retiro" | "Fondo";
  amount: number;
  reason: string | null;
  createdAt: string;
  employeeName?: string;
};

export type CashCutAudit = {
  id: string;
  cashCutId: string;
  userId: string;
  userName?: string;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

export type CashCutPreview = {
  cut: CashCut;
  movements: CashMovement[];
  periodFrom: string;
  periodTo: string;
  byPayment: {
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    saldo: number;
    sinMetodo: number;
  };
  salesCount: number;
  salesTotal: number;
  cashIn: number;
  cashOut: number;
  /** apertura + ventas en efectivo + entradas - salidas - retiros */
  expectedCash: number;
};

type Role = string | undefined;

function money(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

const CUT_SELECT = `
  SELECT cc.*, u.full_name AS employee_name, st.name AS store_name, st.code AS store_code
  FROM cash_cuts cc
  JOIN users u ON u.id = cc.user_id
  JOIN stores st ON st.id = cc.store_id`;

function loadCutRow(db: Db, id: string): Record<string, unknown> {
  return assertFound(
    db.prepare(`${CUT_SELECT} WHERE cc.id = ?`).get(id) as
      | Record<string, unknown>
      | undefined,
    "Corte de caja no encontrado",
  );
}

function assertCanAccess(row: Record<string, unknown>, userId: string, role: Role) {
  if (role === "Admin") return;
  if (String(row.user_id) !== userId) {
    throw new AppError("Solo puede ver o modificar sus propios cortes", 403, "FORBIDDEN");
  }
}

/** Verifica que el usuario pueda ver el corte (Admin: todos; Empleado: solo los suyos). */
export function assertCashCutAccess(
  db: Db,
  cutId: string,
  viewer: { id: string; role: string },
): void {
  assertCanAccess(loadCutRow(db, cutId), viewer.id, viewer.role);
}

function listMovements(db: Db, cutId: string): CashMovement[] {
  const rows = db
    .prepare(
      `SELECT m.*, u.full_name AS employee_name
       FROM cash_movements m
       JOIN users u ON u.id = m.user_id
       WHERE m.cash_cut_id = ?
       ORDER BY m.created_at, m.rowid`,
    )
    .all(cutId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    cashCutId: String(r.cash_cut_id),
    storeId: String(r.store_id),
    userId: String(r.user_id),
    type: r.type as CashMovement["type"],
    amount: Number(r.amount),
    reason: r.reason == null ? null : String(r.reason),
    createdAt: String(r.created_at),
    employeeName: String(r.employee_name),
  }));
}

type Totals = {
  salesCash: number;
  salesCard: number;
  salesTransfer: number;
  salesCredit: number;
  salesNoMethod: number;
  salesTotal: number;
  salesCount: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  periodFrom: string;
  periodTo: string;
};

function computeTotals(db: Db, row: Record<string, unknown>): Totals {
  const periodFrom = String(row.opened_at);
  const periodTo = row.closed_at == null ? nowIso() : String(row.closed_at);

  const sales = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN payment_method = 'Efectivo' THEN total ELSE 0 END), 0) AS cash,
         COALESCE(SUM(CASE WHEN payment_method = 'Tarjeta' THEN total ELSE 0 END), 0) AS card,
         COALESCE(SUM(CASE WHEN payment_method = 'Transferencia' THEN total ELSE 0 END), 0) AS transfer,
         COALESCE(SUM(CASE WHEN payment_method = 'Saldo' THEN total ELSE 0 END), 0) AS credit,
         COALESCE(SUM(CASE WHEN payment_method IS NULL THEN total ELSE 0 END), 0) AS no_method,
         COALESCE(SUM(total), 0) AS total,
         COUNT(*) AS n
       FROM sales
       WHERE ticket_printed = 1 AND store_id = ? AND user_id = ?
         AND created_at >= ? AND created_at <= ?`,
    )
    .get(row.store_id, row.user_id, periodFrom, periodTo) as {
    cash: number;
    card: number;
    transfer: number;
    credit: number;
    no_method: number;
    total: number;
    n: number;
  };

  const mov = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('Entrada', 'Fondo') THEN amount ELSE 0 END), 0) AS cash_in,
         COALESCE(SUM(CASE WHEN type IN ('Salida', 'Retiro') THEN amount ELSE 0 END), 0) AS cash_out
       FROM cash_movements WHERE cash_cut_id = ?`,
    )
    .get(String(row.id)) as { cash_in: number; cash_out: number };

  const salesCash = money(sales.cash);
  const cashIn = money(mov.cash_in);
  const cashOut = money(mov.cash_out);
  return {
    salesCash,
    salesCard: money(sales.card),
    salesTransfer: money(sales.transfer),
    salesCredit: money(sales.credit),
    salesNoMethod: money(sales.no_method),
    salesTotal: money(sales.total),
    salesCount: sales.n,
    cashIn,
    cashOut,
    expectedCash: money(Number(row.opening_cash ?? 0) + salesCash + cashIn - cashOut),
    periodFrom,
    periodTo,
  };
}

function withTotals(row: Record<string, unknown>, t: Totals): CashCut {
  return mapCashCut({
    ...row,
    sales_cash: t.salesCash,
    sales_card: t.salesCard,
    sales_transfer: t.salesTransfer,
    sales_credit: t.salesCredit,
    sales_total: t.salesTotal,
    sales_count: t.salesCount,
    cash_in: t.cashIn,
    cash_out: t.cashOut,
    expected_cash: row.status === "Cerrado" ? row.expected_cash : t.expectedCash,
  });
}

function writeAudit(
  db: Db,
  cutId: string,
  userId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  db.prepare(
    `INSERT INTO cash_cut_audits (id, cash_cut_id, user_id, action, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("cca"),
    cutId,
    userId,
    action,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
    nowIso(),
  );
}

function snapshot(row: Record<string, unknown>) {
  const { employee_name, store_name, store_code, ...rest } = row;
  void employee_name;
  void store_name;
  void store_code;
  return rest;
}

export function openCashCut(
  db: Db,
  userId: string,
  input: OpenCashCutInput,
): CashCut {
  assertFound(
    db.prepare("SELECT id FROM stores WHERE id = ?").get(input.storeId),
    "Sucursal no encontrada",
  );
  assertFound(
    db.prepare("SELECT id FROM users WHERE id = ?").get(userId),
    "Usuario no encontrado",
  );
  const open = db
    .prepare(
      "SELECT id FROM cash_cuts WHERE user_id = ? AND status = 'Abierto' LIMIT 1",
    )
    .get(userId) as { id: string } | undefined;
  if (open) {
    throw new AppError(
      "Ya tienes un corte de caja abierto. Ciérralo antes de abrir otro.",
      409,
      "CASH_CUT_OPEN",
    );
  }

  const id = newId("cut");
  const now = nowIso();
  db.prepare(
    `INSERT INTO cash_cuts (id, store_id, user_id, opened_at, opening_cash, notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Abierto', ?)`,
  ).run(
    id,
    input.storeId,
    userId,
    now,
    money(input.openingCash),
    input.notes?.trim() || null,
    now,
  );
  return mapCashCut(loadCutRow(db, id));
}

/** Corte abierto por cuenta (userId). storeId es filtro opcional (misma persona / varias sucursales). */
export function getOpenCashCut(
  db: Db,
  storeId?: string | null,
  userId?: string,
): CashCut | null {
  const clauses = ["cc.status = 'Abierto'"];
  const params: unknown[] = [];
  if (userId) {
    clauses.push("cc.user_id = ?");
    params.push(userId);
  }
  if (storeId) {
    clauses.push("cc.store_id = ?");
    params.push(storeId);
  }
  if (!userId && !storeId) return null;
  const row = db
    .prepare(
      `${CUT_SELECT}
       WHERE ${clauses.join(" AND ")}
       ORDER BY cc.opened_at DESC LIMIT 1`,
    )
    .get(...params) as Record<string, unknown> | undefined;
  if (!row) return null;
  return withTotals(row, computeTotals(db, row));
}

export function previewCashCut(db: Db, cutId: string): CashCutPreview {
  const row = loadCutRow(db, cutId);
  const t = computeTotals(db, row);
  return {
    cut: withTotals(row, t),
    movements: listMovements(db, cutId),
    periodFrom: t.periodFrom,
    periodTo: t.periodTo,
    byPayment: {
      efectivo: t.salesCash,
      tarjeta: t.salesCard,
      transferencia: t.salesTransfer,
      saldo: t.salesCredit,
      sinMetodo: t.salesNoMethod,
    },
    salesCount: t.salesCount,
    salesTotal: t.salesTotal,
    cashIn: t.cashIn,
    cashOut: t.cashOut,
    expectedCash: t.expectedCash,
  };
}

export function addCashMovement(
  db: Db,
  cutId: string,
  userId: string,
  input: CashMovementInput,
  role?: Role,
): CashMovement {
  const row = loadCutRow(db, cutId);
  assertCanAccess(row, userId, role);

  const closed = row.status === "Cerrado";
  if (closed && role !== "Admin") {
    throw new AppError(
      "El corte ya está cerrado; solo un administrador puede modificarlo",
      409,
      "CASH_CUT_CLOSED",
    );
  }

  const id = newId("cmv");
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO cash_movements (id, cash_cut_id, store_id, user_id, type, amount, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      cutId,
      row.store_id,
      userId,
      input.type,
      money(input.amount),
      input.reason.trim(),
      nowIso(),
    );

    if (closed) {
      // Corte cerrado: recalcular y dejar rastro en auditoría.
      const t = computeTotals(db, row);
      const counted = row.counted_cash == null ? null : Number(row.counted_cash);
      db.prepare(
        `UPDATE cash_cuts
         SET cash_in = ?, cash_out = ?, expected_cash = ?, difference = ?
         WHERE id = ?`,
      ).run(
        t.cashIn,
        t.cashOut,
        t.expectedCash,
        counted == null ? null : money(counted - t.expectedCash),
        cutId,
      );
      const after = loadCutRow(db, cutId);
      writeAudit(
        db,
        cutId,
        userId,
        `Movimiento en corte cerrado: ${input.type} $${money(input.amount).toFixed(2)}`,
        snapshot(row),
        snapshot(after),
      );
    }
  });
  tx();

  return assertFound(
    listMovements(db, cutId).find((m) => m.id === id),
    "Movimiento no registrado",
  );
}

export function closeCashCut(
  db: Db,
  cutId: string,
  userId: string,
  input: CloseCashCutInput,
  role?: Role,
): CashCutPreview {
  const row = loadCutRow(db, cutId);
  assertCanAccess(row, userId, role);

  const alreadyClosed = row.status === "Cerrado";
  if (alreadyClosed && role !== "Admin") {
    throw new AppError(
      "El corte ya está cerrado; solo un administrador puede corregirlo",
      409,
      "CASH_CUT_CLOSED",
    );
  }

  const tx = db.transaction(() => {
    const closedAt = alreadyClosed ? String(row.closed_at) : nowIso();
    const t = computeTotals(db, { ...row, closed_at: closedAt });
    const counted = money(input.countedCash);
    const difference = money(counted - t.expectedCash);
    const notes = input.notes?.trim() || (row.notes == null ? null : String(row.notes));

    db.prepare(
      `UPDATE cash_cuts
       SET closed_at = ?, expected_cash = ?, counted_cash = ?, difference = ?,
           sales_cash = ?, sales_card = ?, sales_transfer = ?, sales_credit = ?,
           sales_total = ?, sales_count = ?, cash_in = ?, cash_out = ?,
           notes = ?, status = 'Cerrado'
       WHERE id = ?`,
    ).run(
      closedAt,
      t.expectedCash,
      counted,
      difference,
      t.salesCash,
      t.salesCard,
      t.salesTransfer,
      t.salesCredit,
      t.salesTotal,
      t.salesCount,
      t.cashIn,
      t.cashOut,
      notes,
      cutId,
    );

    writeAudit(
      db,
      cutId,
      userId,
      alreadyClosed ? "Corrección de corte cerrado" : "Cierre de corte",
      snapshot(row),
      snapshot(loadCutRow(db, cutId)),
    );
  });
  tx();

  return previewCashCut(db, cutId);
}

export type CashCutFilters = {
  storeId?: string;
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export function listCashCuts(
  db: Db,
  filters: CashCutFilters = {},
  viewer?: { id: string; role: string },
): CashCut[] {
  const effective = { ...filters };
  if (viewer && viewer.role !== "Admin") effective.userId = viewer.id;

  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    clauses.push(sql);
    params.push(value);
  };
  if (effective.storeId) add("cc.store_id = ?", effective.storeId);
  if (effective.userId) add("cc.user_id = ?", effective.userId);
  if (effective.status) add("cc.status = ?", effective.status);
  if (effective.from) add("cc.opened_at >= ?", effective.from);
  if (effective.to) add("cc.opened_at <= ?", effective.to);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(Math.trunc(effective.limit ?? 200), 1), 500);

  const rows = db
    .prepare(`${CUT_SELECT} ${where} ORDER BY cc.opened_at DESC LIMIT ?`)
    .all(...params, limit) as Record<string, unknown>[];

  return rows.map((row) =>
    row.status === "Abierto" ? withTotals(row, computeTotals(db, row)) : mapCashCut(row),
  );
}

export type CashCutDetail = CashCutPreview & {
  sales: {
    id: string;
    folio: string;
    createdAt: string;
    paymentMethod: string | null;
    saleType: string;
    total: number;
  }[];
  audits: CashCutAudit[];
};

export function getCashCutDetail(db: Db, id: string): CashCutDetail {
  const row = loadCutRow(db, id);
  const preview = previewCashCut(db, id);

  const sales = (
    db
      .prepare(
        `SELECT id, folio, created_at, payment_method, sale_type, total
         FROM sales
         WHERE ticket_printed = 1 AND store_id = ? AND user_id = ?
           AND created_at >= ? AND created_at <= ?
         ORDER BY created_at`,
      )
      .all(row.store_id, row.user_id, preview.periodFrom, preview.periodTo) as Record<
      string,
      unknown
    >[]
  ).map((s) => ({
    id: String(s.id),
    folio: String(s.folio),
    createdAt: String(s.created_at),
    paymentMethod: s.payment_method == null ? null : String(s.payment_method),
    saleType: String(s.sale_type),
    total: money(Number(s.total)),
  }));

  const parse = (value: unknown) => {
    if (value == null) return null;
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  };
  const audits = (
    db
      .prepare(
        `SELECT a.*, u.full_name AS user_name
         FROM cash_cut_audits a
         JOIN users u ON u.id = a.user_id
         WHERE a.cash_cut_id = ?
         ORDER BY a.created_at, a.rowid`,
      )
      .all(id) as Record<string, unknown>[]
  ).map((a) => ({
    id: String(a.id),
    cashCutId: String(a.cash_cut_id),
    userId: String(a.user_id),
    userName: String(a.user_name),
    action: String(a.action),
    before: parse(a.before_json),
    after: parse(a.after_json),
    createdAt: String(a.created_at),
  }));

  return { ...preview, sales, audits };
}
