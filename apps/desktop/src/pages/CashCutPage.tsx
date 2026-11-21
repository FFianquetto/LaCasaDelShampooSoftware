import { FormEvent, useCallback, useEffect, useState } from "react";
import type {
  CashCut,
  CashMovementType,
  Store,
  User,
} from "@lcds/shared";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { StoreName } from "../StoreName";
import { DateInput } from "../DateInput";
import { MoneyInput, parseMoneyInput } from "../MoneyInput";
import {
  dateToIso,
  defaultDateFrom,
  defaultDateTo,
  errMsg,
  formatDateTime,
  money,
  qs,
  shortStore,
} from "../util";

type CashMovement = {
  id: string;
  cashCutId: string;
  type: CashMovementType;
  amount: number;
  reason: string | null;
  createdAt: string;
  employeeName?: string;
};

type CashCutAudit = {
  id: string;
  userName?: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

type CashCutPreview = {
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
  expectedCash: number;
};

type CurrentResponse = CashCutPreview | { cut: null };

type CashCutDetail = CashCutPreview & {
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

const MOVEMENT_TYPES: { value: CashMovementType; label: string }[] = [
  { value: "Entrada", label: "Entrada (suma a caja)" },
  { value: "Fondo", label: "Fondo (suma a caja)" },
  { value: "Salida", label: "Salida (resta de caja)" },
  { value: "Retiro", label: "Retiro (resta de caja)" },
];

function differenceBadge(value: number | null | undefined) {
  if (value == null) return <span className="badge muted">Sin cerrar</span>;
  if (Math.abs(value) < 0.005) return <span className="badge ok">Cuadra</span>;
  return value > 0 ? (
    <span className="badge warn">Sobran {money(value)}</span>
  ) : (
    <span className="badge late">Faltan {money(Math.abs(value))}</span>
  );
}

function PreviewBlock({ data }: { data: CashCutPreview }) {
  const { cut } = data;
  const expected =
    cut.status === "Cerrado" && cut.expectedCash != null
      ? cut.expectedCash
      : data.expectedCash;
  return (
    <>
      <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat">
          Efectivo
          <strong>{money(data.byPayment.efectivo)}</strong>
        </div>
        <div className="stat">
          Tarjeta
          <strong>{money(data.byPayment.tarjeta)}</strong>
        </div>
        <div className="stat">
          Transferencia
          <strong>{money(data.byPayment.transferencia)}</strong>
        </div>
        <div className="stat">
          Saldo
          <strong>{money(data.byPayment.saldo)}</strong>
          <span>No entra a caja</span>
        </div>
      </div>
      {data.byPayment.sinMetodo > 0 && (
        <p className="notice">
          Hay {money(data.byPayment.sinMetodo)} en ventas sin método de pago.
        </p>
      )}
      <div className="notice">
        <strong>Efectivo esperado en caja: {money(expected)}</strong>
        <br />
        {data.salesCount} ventas · total vendido {money(data.salesTotal)}
      </div>
    </>
  );
}

function MovementsTable({ movements }: { movements: CashMovement[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Tipo</th>
            <th>Monto</th>
            <th>Motivo</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          {movements.length === 0 ? (
            <tr>
              <td colSpan={5}>Sin movimientos de caja.</td>
            </tr>
          ) : (
            movements.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>{item.type}</td>
                <td>
                  {item.type === "Salida" || item.type === "Retiro" ? "−" : "+"}
                  {money(item.amount)}
                </td>
                <td>{item.reason ?? "—"}</td>
                <td>{item.employeeName ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const AUDIT_FIELDS: Record<string, string> = {
  expected_cash: "Efectivo esperado",
  counted_cash: "Efectivo contado",
  difference: "Diferencia",
  cash_in: "Entradas",
  cash_out: "Salidas",
  sales_cash: "Ventas efectivo",
  sales_card: "Ventas tarjeta",
  sales_transfer: "Ventas transferencia",
  sales_credit: "Ventas saldo",
  sales_total: "Total ventas",
  notes: "Notas",
  status: "Estatus",
  closed_at: "Cerrado en",
};

function auditChanges(audit: CashCutAudit): string {
  const before = audit.before ?? {};
  const after = audit.after ?? {};
  const parts: string[] = [];
  for (const key of Object.keys(AUDIT_FIELDS)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      const fmt = (value: unknown) =>
        value == null || value === "" ? "—" : String(value);
      parts.push(`${AUDIT_FIELDS[key]}: ${fmt(before[key])} → ${fmt(after[key])}`);
    }
  }
  return parts.join(" · ") || "Sin cambios visibles";
}

export function CashCutPage() {
  const { isAdmin, store, user } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [storeId, setStoreId] = useState(store?.id ?? "");
  /** Admin: revisar corte abierto de otra cuenta (solo lectura). Vacío = mi corte. */
  const [reviewUserId, setReviewUserId] = useState("");
  const activeStoreId = isAdmin ? storeId : (store?.id ?? "");
  const viewingOther =
    isAdmin && Boolean(reviewUserId) && reviewUserId !== user?.id;

  const [current, setCurrent] = useState<CashCutPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [openingCash, setOpeningCash] = useState("");
  const [openNotes, setOpenNotes] = useState("");

  const [moveType, setMoveType] = useState<CashMovementType>("Salida");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");

  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closed, setClosed] = useState<CashCutPreview | null>(null);

  const [cuts, setCuts] = useState<CashCut[]>([]);
  const [fStore, setFStore] = useState("");
  const [fUser, setFUser] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fFrom, setFFrom] = useState(defaultDateFrom);
  const [fTo, setFTo] = useState(defaultDateTo);
  const [detail, setDetail] = useState<CashCutDetail | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
    void api<User[]>("/users").then(setUsers).catch(() => setUsers([]));
  }, [isAdmin]);

  const loadCurrent = useCallback(async () => {
    try {
      const data = await api<CurrentResponse>(
        `/cash-cuts/current?${qs({
          // Empleado: su sucursal. Admin en "mi corte": sucursal elegida.
          // Al revisar otra cuenta: no forzar sucursal (el corte va por usuario).
          storeId: viewingOther
            ? undefined
            : isAdmin
              ? activeStoreId || undefined
              : store?.id,
          userId: viewingOther ? reviewUserId : undefined,
        })}`,
      );
      setCurrent("movements" in data ? data : null);
    } catch (err) {
      setCurrent(null);
      setError(errMsg(err, "No se pudo cargar el corte"));
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, isAdmin, reviewUserId, store?.id, viewingOther]);

  const loadList = useCallback(async () => {
    try {
      const query = qs({
        storeId: isAdmin ? fStore : undefined,
        userId: isAdmin ? fUser : undefined,
        status: fStatus,
        from: dateToIso(fFrom),
        to: dateToIso(fTo, true),
        limit: 100,
      });
      setCuts(await api<CashCut[]>(`/cash-cuts?${query}`));
    } catch (err) {
      setCuts([]);
      setError(errMsg(err, "No se pudo cargar el listado"));
    }
  }, [isAdmin, fStore, fUser, fStatus, fFrom, fTo]);

  useEffect(() => {
    setClosed(null);
    setLoading(true);
    void loadCurrent();
  }, [loadCurrent]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function onOpen(event: FormEvent) {
    event.preventDefault();
    const amount = parseMoneyInput(openingCash);
    if (amount == null) {
      setError("Escribe el efectivo inicial (puede ser 0)");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api("/cash-cuts/open", {
        method: "POST",
        body: JSON.stringify({
          storeId: activeStoreId,
          openingCash: amount,
          notes: openNotes.trim() || undefined,
        }),
      });
      setOpeningCash("");
      setOpenNotes("");
      setClosed(null);
      setSuccess("Corte abierto.");
      await Promise.all([loadCurrent(), loadList()]);
    } catch (err) {
      setError(errMsg(err, "No se pudo abrir el corte"));
    } finally {
      setBusy(false);
    }
  }

  async function onMovement(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const amount = parseMoneyInput(moveAmount);
    if (amount == null || amount <= 0) {
      setError("El monto debe ser mayor a 0");
      return;
    }
    if (!moveReason.trim()) {
      setError("Escribe el motivo del movimiento");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/cash-cuts/${current.cut.id}/movements`, {
        method: "POST",
        body: JSON.stringify({
          type: moveType,
          amount,
          reason: moveReason.trim(),
        }),
      });
      setMoveAmount("");
      setMoveReason("");
      setSuccess("Movimiento registrado.");
      await loadCurrent();
    } catch (err) {
      setError(errMsg(err, "No se pudo registrar el movimiento"));
    } finally {
      setBusy(false);
    }
  }

  async function onClose(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const counted = parseMoneyInput(countedCash);
    if (counted == null) {
      setError("Escribe el efectivo contado en caja");
      return;
    }
    if (
      !window.confirm(
        "¿Cerrar el corte con este efectivo contado? Después solo un administrador puede corregirlo.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api<CashCutPreview>(
        `/cash-cuts/${current.cut.id}/close`,
        {
          method: "POST",
          body: JSON.stringify({
            countedCash: counted,
            notes: closeNotes.trim() || undefined,
          }),
        },
      );
      setClosed(result);
      setCountedCash("");
      setCloseNotes("");
      await Promise.all([loadCurrent(), loadList()]);
    } catch (err) {
      setError(errMsg(err, "No se pudo cerrar el corte"));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    setError(null);
    try {
      setDetail(await api<CashCutDetail>(`/cash-cuts/${id}`));
    } catch (err) {
      setError(errMsg(err, "No se pudo cargar el detalle"));
    }
  }

  const selectedStore = stores.find((item) => item.id === activeStoreId);
  const reviewUser = users.find((item) => item.id === reviewUserId);
  const storeLabel = isAdmin
    ? selectedStore
      ? shortStore(selectedStore.name)
      : "todas / la del corte"
    : store
      ? shortStore(store.name)
      : "tu sucursal";

  return (
    <div>
      <h1 className="page-title">Corte de caja</h1>
      <p className="page-sub">
        Cada cuenta sube su propio corte. Empleados quedan atados a una sucursal;
        el admin puede filtrar por sucursal si la misma persona trabaja en más de
        una. Ahora:{" "}
        {viewingOther ? (
          <>
            revisando a <strong>{reviewUser?.fullName ?? "empleado"}</strong>
          </>
        ) : (
          <>
            tu corte en <StoreName name={storeLabel} dot />
          </>
        )}
      </p>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      {isAdmin && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <div className="form-inline" style={{ marginBottom: "0.75rem" }}>
            <div className="form-row" style={{ marginBottom: 0, minWidth: "14rem" }}>
              <label>Cuenta / empleado</label>
              <select
                value={reviewUserId}
                onChange={(e) => {
                  setReviewUserId(e.target.value);
                  setClosed(null);
                  setLoading(true);
                }}
              >
                <option value="">Mi corte</option>
                {users
                  .filter((item) => item.active && item.id !== user?.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName} ({item.role})
                    </option>
                  ))}
              </select>
            </div>
          </div>
          {!viewingOther && (
            <div className="store-buttons" style={{ marginLeft: 0 }}>
              {stores.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === storeId ? "btn" : "btn secondary"}
                  onClick={() => setStoreId(item.id)}
                >
                  {shortStore(item.name)}
                </button>
              ))}
            </div>
          )}
          {viewingOther && (
            <p className="notice" style={{ marginBottom: 0 }}>
              Solo lectura: no puedes mover ni cerrar el corte de otra cuenta.
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="panel">
          <p className="page-sub" style={{ margin: 0 }}>
            Cargando…
          </p>
        </div>
      ) : current ? (
        <>
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              Corte abierto
            </h2>
            <p className="page-sub">
              Abierto el {formatDateTime(current.cut.openedAt)} · apertura{" "}
              {money(current.cut.openingCash)}
              {current.cut.notes ? ` · ${current.cut.notes}` : ""}
            </p>
            <PreviewBlock data={current} />
            <MovementsTable movements={current.movements} />
          </div>

          {!viewingOther && (
            <>
              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="page-title" style={{ fontSize: "1.2rem" }}>
                  Agregar movimiento
                </h2>
                <form className="form-inline" onSubmit={onMovement}>
                  <div className="form-row" style={{ marginBottom: 0 }}>
                    <label>Tipo</label>
                    <select
                      value={moveType}
                      onChange={(e) =>
                        setMoveType(e.target.value as CashMovementType)
                      }
                    >
                      {MOVEMENT_TYPES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row" style={{ marginBottom: 0 }}>
                    <label>Monto</label>
                    <MoneyInput
                      value={moveAmount}
                      onChange={setMoveAmount}
                      required
                      aria-label="Monto"
                    />
                  </div>
                  <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
                    <label>Motivo</label>
                    <input
                      value={moveReason}
                      maxLength={200}
                      onChange={(e) => setMoveReason(e.target.value)}
                      required
                    />
                  </div>
                  <button className="btn" type="submit" disabled={busy}>
                    Agregar
                  </button>
                </form>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="page-title" style={{ fontSize: "1.2rem" }}>
                  Cerrar corte
                </h2>
                <p className="page-sub">
                  Cuenta el efectivo que hay en caja. Esperado:{" "}
                  <strong>{money(current.expectedCash)}</strong>
                </p>
                <form className="form-inline" onSubmit={onClose}>
                  <div className="form-row" style={{ marginBottom: 0 }}>
                    <label>Efectivo contado</label>
                    <MoneyInput
                      value={countedCash}
                      onChange={setCountedCash}
                      required
                      aria-label="Efectivo contado"
                    />
                  </div>
                  <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
                    <label>Notas</label>
                    <input
                      value={closeNotes}
                      onChange={(e) => setCloseNotes(e.target.value)}
                    />
                  </div>
                  <button className="btn accent" type="submit" disabled={busy}>
                    {busy ? "Cerrando…" : "Cerrar corte"}
                  </button>
                </form>
                {parseMoneyInput(countedCash) != null && (
                  <p className="report-total">
                    Diferencia estimada:{" "}
                    {money(
                      (parseMoneyInput(countedCash) ?? 0) - current.expectedCash,
                    )}
                  </p>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {closed && !viewingOther && (
            <div className="panel" style={{ marginBottom: "1rem" }}>
              <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
                Corte cerrado
              </h2>
              <p className="page-sub">
                Contado {money(closed.cut.countedCash)} · esperado{" "}
                {money(closed.cut.expectedCash ?? closed.expectedCash)}
              </p>
              <p className="report-total" style={{ marginTop: 0 }}>
                Diferencia: {money(closed.cut.difference)}{" "}
                {differenceBadge(closed.cut.difference)}
              </p>
              <PreviewBlock data={closed} />
              <MovementsTable movements={closed.movements} />
            </div>
          )}
          {!viewingOther && (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <h2 className="page-title" style={{ fontSize: "1.2rem" }}>
              Abrir corte
            </h2>
            <p className="page-sub">
              No tienes un corte abierto
              {activeStoreId ? " en esta sucursal" : ""}. Cada cuenta abre el
              suyo.
            </p>
            <form className="form-inline" onSubmit={onOpen}>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Efectivo inicial</label>
                <MoneyInput
                  value={openingCash}
                  onChange={setOpeningCash}
                  required
                  aria-label="Efectivo inicial"
                />
              </div>
              <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
                <label>Notas</label>
                <input
                  value={openNotes}
                  onChange={(e) => setOpenNotes(e.target.value)}
                />
              </div>
              <button className="btn" type="submit" disabled={busy || !activeStoreId}>
                Abrir corte
              </button>
            </form>
          </div>
          )}
          {viewingOther && (
            <div className="panel" style={{ marginBottom: "1rem" }}>
              <p className="page-sub" style={{ margin: 0 }}>
                {reviewUser?.fullName ?? "Ese empleado"} no tiene un corte abierto.
              </p>
            </div>
          )}
        </>
      )}

      <div className="panel table-wrap">
        <h2 className="page-title" style={{ fontSize: "1.2rem" }}>
          {isAdmin ? "Cortes por cuenta" : "Mis cortes"}
        </h2>
        <div className="form-inline" style={{ marginBottom: "0.85rem" }}>
          {isAdmin && (
            <>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Empleado</label>
                <select value={fUser} onChange={(e) => setFUser(e.target.value)}>
                  <option value="">Todas las cuentas</option>
                  {users.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Sucursal</label>
                <select value={fStore} onChange={(e) => setFStore(e.target.value)}>
                  <option value="">Todas</option>
                  {stores.map((item) => (
                    <option key={item.id} value={item.id}>
                      {shortStore(item.name)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Estatus</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Todos</option>
              <option value="Abierto">Abierto</option>
              <option value="Cerrado">Cerrado</option>
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Desde</label>
            <DateInput value={fFrom} onChange={setFFrom} aria-label="Desde" />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Hasta</label>
            <DateInput value={fTo} onChange={setFTo} aria-label="Hasta" />
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Apertura</th>
              <th>Sucursal</th>
              <th>Empleado</th>
              <th>Estatus</th>
              <th>Ventas</th>
              <th>Esperado</th>
              <th>Contado</th>
              <th>Diferencia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cuts.length === 0 ? (
              <tr>
                <td colSpan={9}>Sin cortes con esos filtros.</td>
              </tr>
            ) : (
              cuts.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.openedAt)}</td>
                  <td>{item.storeCode ?? "—"}</td>
                  <td>{item.employeeName ?? "—"}</td>
                  <td>
                    <span className={item.status === "Abierto" ? "badge warn" : "badge ok"}>
                      {item.status}
                    </span>
                  </td>
                  <td>{money(item.salesTotal)}</td>
                  <td>{item.expectedCash == null ? "—" : money(item.expectedCash)}</td>
                  <td>{item.countedCash == null ? "—" : money(item.countedCash)}</td>
                  <td>{differenceBadge(item.difference)}</td>
                  <td>
                    <button
                      className="btn secondary"
                      type="button"
                      style={{ padding: "0.3rem 0.55rem" }}
                      onClick={() => void openDetail(item.id)}
                    >
                      Detalle
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="modal-back" onClick={() => setDetail(null)}>
          <div
            className="modal wide"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              Corte de {detail.cut.employeeName ?? "—"} ·{" "}
              {detail.cut.storeCode ?? ""}
            </h2>
            <p className="page-sub">
              {formatDateTime(detail.periodFrom)} → {formatDateTime(detail.periodTo)} ·{" "}
              {detail.cut.status}
              {detail.cut.status === "Cerrado" && (
                <>
                  {" "}
                  · contado {money(detail.cut.countedCash)} · diferencia{" "}
                  {differenceBadge(detail.cut.difference)}
                </>
              )}
            </p>
            {detail.cut.notes && <p className="notice">{detail.cut.notes}</p>}
            <PreviewBlock data={detail} />

            <h3 className="detail-title">Movimientos</h3>
            <MovementsTable movements={detail.movements} />

            <h3 className="detail-title">Ventas del corte</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Hora</th>
                    <th>Tipo</th>
                    <th>Pago</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sales.length === 0 ? (
                    <tr>
                      <td colSpan={5}>Sin ventas en este corte.</td>
                    </tr>
                  ) : (
                    detail.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{sale.folio}</td>
                        <td>{formatDateTime(sale.createdAt)}</td>
                        <td>{sale.saleType}</td>
                        <td>{sale.paymentMethod ?? "Sin método"}</td>
                        <td>{money(sale.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <h3 className="detail-title">Auditoría</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Acción</th>
                    <th>Cambios</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.audits.length === 0 ? (
                    <tr>
                      <td colSpan={4}>Sin registros de auditoría.</td>
                    </tr>
                  ) : (
                    detail.audits.map((audit) => (
                      <tr key={audit.id}>
                        <td>{formatDateTime(audit.createdAt)}</td>
                        <td>{audit.userName ?? "—"}</td>
                        <td>{audit.action}</td>
                        <td>{auditChanges(audit)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <button
              className="btn secondary"
              type="button"
              style={{ width: "100%", marginTop: "1rem" }}
              onClick={() => setDetail(null)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
