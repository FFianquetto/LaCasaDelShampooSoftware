import { FormEvent, useCallback, useEffect, useState } from "react";
import type {
  CashCut,
  CashMovementType,
  Store,
  User,
} from "@lcds/shared";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ConfirmModal } from "../components/ConfirmModal";
import { SelectField } from "../components/SelectField";
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
  { value: "Entrada", label: "Entrada" },
  { value: "Fondo", label: "Fondo" },
  { value: "Salida", label: "Salida" },
  { value: "Retiro", label: "Retiro" },
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
      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat">
          Debe haber en caja
          <strong>{money(expected)}</strong>
        </div>
        <div className="stat">
          Ventas
          <strong>{data.salesCount}</strong>
          <span>{money(data.salesTotal)}</span>
        </div>
        <div className="stat">
          Por método
          <strong style={{ fontSize: "1rem", fontWeight: 600 }}>
            Ef. {money(data.byPayment.efectivo)}
          </strong>
          <span>
            Tarjeta {money(data.byPayment.tarjeta)} · Transf.{" "}
            {money(data.byPayment.transferencia)}
            {data.byPayment.saldo > 0
              ? ` · Saldo ${money(data.byPayment.saldo)}`
              : ""}
          </span>
        </div>
      </div>
      {data.byPayment.sinMetodo > 0 && (
        <p className="notice">
          Hay {money(data.byPayment.sinMetodo)} en ventas sin método de pago.
        </p>
      )}
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
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingCounted, setPendingCounted] = useState<number | null>(null);

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

  function onClose(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const counted = parseMoneyInput(countedCash);
    if (counted == null) {
      setError("Escribe el efectivo contado en caja");
      return;
    }
    setError(null);
    setPendingCounted(counted);
    setCloseConfirmOpen(true);
  }

  async function confirmCloseCut() {
    if (!current || pendingCounted == null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api<CashCutPreview>(
        `/cash-cuts/${current.cut.id}/close`,
        {
          method: "POST",
          body: JSON.stringify({
            countedCash: pendingCounted,
            notes: closeNotes.trim() || undefined,
          }),
        },
      );
      setClosed(result);
      setCountedCash("");
      setCloseNotes("");
      setCloseConfirmOpen(false);
      setPendingCounted(null);
      await Promise.all([loadCurrent(), loadList()]);
    } catch (err) {
      setError(errMsg(err, "No se pudo cerrar el corte"));
      setCloseConfirmOpen(false);
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
        {viewingOther ? (
          <>
            Revisando a <strong>{reviewUser?.fullName ?? "empleado"}</strong> (solo
            lectura).
          </>
        ) : (
          <>
            1) Abre · 2) Vende · 3) Cuenta el efectivo y cierra. Ahora:{" "}
            <StoreName name={storeLabel} dot />
          </>
        )}
      </p>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      {isAdmin && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <div className="form-inline">
            <SelectField
              label="Ver cuenta"
              value={reviewUserId}
              onChange={(value) => {
                setReviewUserId(value);
                setClosed(null);
                setLoading(true);
              }}
              style={{ minWidth: "14rem" }}
            >
              <option value="">Mi corte</option>
              {users
                .filter((item) => item.active && item.id !== user?.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
            </SelectField>
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
          </div>
        </div>
      )}

      {loading ? (
        <div className="panel">
          <p className="page-sub" style={{ margin: 0 }}>
            Cargando…
          </p>
        </div>
      ) : current ? (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
            Corte abierto
          </h2>
          <p className="page-sub">
            Desde {formatDateTime(current.cut.openedAt)} · inició con{" "}
            {money(current.cut.openingCash)}
            {current.cut.notes ? ` · ${current.cut.notes}` : ""}
          </p>
          <PreviewBlock data={current} />

          <h3 className="detail-title">Movimientos de caja</h3>
          <MovementsTable movements={current.movements} />

          {!viewingOther && (
            <>
              <form
                className="form-inline"
                style={{ marginTop: "0.85rem" }}
                onSubmit={onMovement}
              >
                <SelectField
                  label="Tipo"
                  value={moveType}
                  onChange={(value) => setMoveType(value as CashMovementType)}
                >
                  {MOVEMENT_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </SelectField>
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
                    placeholder="Ej. cambio, retiro a oficina…"
                    onChange={(e) => setMoveReason(e.target.value)}
                    required
                  />
                </div>
                <button className="btn" type="submit" disabled={busy}>
                  Agregar
                </button>
              </form>

              <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.1rem 0" }} />

              <h3 className="detail-title" style={{ marginTop: 0 }}>
                Cerrar: cuenta lo que hay en caja
              </h3>
              <p className="page-sub">
                Debe haber <strong>{money(current.expectedCash)}</strong>. Escribe lo
                que contaste.
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
                  <label>Nota (opcional)</label>
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
                  Diferencia:{" "}
                  {money(
                    (parseMoneyInput(countedCash) ?? 0) - current.expectedCash,
                  )}{" "}
                  {differenceBadge(
                    (parseMoneyInput(countedCash) ?? 0) - current.expectedCash,
                  )}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {!viewingOther && (
            <div className="panel" style={{ marginBottom: "1rem" }}>
              <h2 className="page-title" style={{ fontSize: "1.2rem" }}>
                Abrir corte
              </h2>
              <p className="page-sub">
                Pon cuánto efectivo hay al empezar el turno.
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
                  <label>Nota (opcional)</label>
                  <input
                    value={openNotes}
                    onChange={(e) => setOpenNotes(e.target.value)}
                  />
                </div>
                <button
                  className="btn"
                  type="submit"
                  disabled={busy || !activeStoreId}
                >
                  Abrir corte
                </button>
              </form>
            </div>
          )}
          {closed && !viewingOther && (
            <div className="panel" style={{ marginBottom: "1rem" }}>
              <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
                Listo, corte cerrado
              </h2>
              <p className="report-total" style={{ marginTop: 0 }}>
                Contado {money(closed.cut.countedCash)} · debía haber{" "}
                {money(closed.cut.expectedCash ?? closed.expectedCash)} ·{" "}
                {differenceBadge(closed.cut.difference)}
              </p>
              <PreviewBlock data={closed} />
              <MovementsTable movements={closed.movements} />
            </div>
          )}
          {viewingOther && (
            <div className="panel" style={{ marginBottom: "1rem" }}>
              <p className="page-sub" style={{ margin: 0 }}>
                {reviewUser?.fullName ?? "Ese empleado"} no tiene corte abierto.
              </p>
            </div>
          )}
        </>
      )}

      <div className="panel table-wrap">
        <h2 className="page-title" style={{ fontSize: "1.2rem" }}>
          {isAdmin ? "Historial de cortes" : "Mis cortes anteriores"}
        </h2>
        <div className="form-inline" style={{ marginBottom: "0.85rem" }}>
          {isAdmin && (
            <>
              <SelectField
                label="Empleado"
                value={fUser}
                onChange={setFUser}
              >
                <option value="">Todos</option>
                {users.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Sucursal"
                value={fStore}
                onChange={setFStore}
              >
                <option value="">Todas</option>
                {stores.map((item) => (
                  <option key={item.id} value={item.id}>
                    {shortStore(item.name)}
                  </option>
                ))}
              </SelectField>
            </>
          )}
          <SelectField label="Estatus" value={fStatus} onChange={setFStatus}>
            <option value="">Todos</option>
            <option value="Abierto">Abierto</option>
            <option value="Cerrado">Cerrado</option>
          </SelectField>
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
              {isAdmin && <th>Sucursal</th>}
              {isAdmin && <th>Empleado</th>}
              <th>Estatus</th>
              <th>Ventas</th>
              <th>Debía haber</th>
              <th>Contado</th>
              <th>Diferencia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cuts.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 9 : 7}>Sin cortes con esos filtros.</td>
              </tr>
            ) : (
              cuts.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.openedAt)}</td>
                  {isAdmin && <td>{item.storeCode ?? "—"}</td>}
                  {isAdmin && <td>{item.employeeName ?? "—"}</td>}
                  <td>
                    <span
                      className={
                        item.status === "Abierto" ? "badge warn" : "badge ok"
                      }
                    >
                      {item.status}
                    </span>
                  </td>
                  <td>{money(item.salesTotal)}</td>
                  <td>
                    {item.expectedCash == null ? "—" : money(item.expectedCash)}
                  </td>
                  <td>
                    {item.countedCash == null ? "—" : money(item.countedCash)}
                  </td>
                  <td>{differenceBadge(item.difference)}</td>
                  <td>
                    <button
                      className="btn secondary"
                      type="button"
                      style={{ padding: "0.3rem 0.55rem" }}
                      onClick={() => void openDetail(item.id)}
                    >
                      Ver
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
              Corte · {detail.cut.employeeName ?? "—"}
              {detail.cut.storeCode ? ` · ${detail.cut.storeCode}` : ""}
            </h2>
            <p className="page-sub">
              {formatDateTime(detail.periodFrom)} →{" "}
              {formatDateTime(detail.periodTo)} · {detail.cut.status}
              {detail.cut.status === "Cerrado" && (
                <>
                  {" "}
                  · contado {money(detail.cut.countedCash)} ·{" "}
                  {differenceBadge(detail.cut.difference)}
                </>
              )}
            </p>
            {detail.cut.notes && <p className="notice">{detail.cut.notes}</p>}
            <PreviewBlock data={detail} />

            <h3 className="detail-title">Movimientos</h3>
            <MovementsTable movements={detail.movements} />

            <h3 className="detail-title">Ventas</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Hora</th>
                    <th>Pago</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sales.length === 0 ? (
                    <tr>
                      <td colSpan={4}>Sin ventas en este corte.</td>
                    </tr>
                  ) : (
                    detail.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{sale.folio}</td>
                        <td>{formatDateTime(sale.createdAt)}</td>
                        <td>{sale.paymentMethod ?? "—"}</td>
                        <td>{money(sale.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {isAdmin && (
              <>
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
                          <td colSpan={4}>Sin registros.</td>
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
              </>
            )}

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

      <ConfirmModal
        open={closeConfirmOpen}
        title="Cerrar corte"
        message={
          pendingCounted == null
            ? "¿Cerrar el corte? Después solo un administrador puede corregirlo."
            : `¿Cerrar el corte con ${money(pendingCounted)} contados? Después solo un administrador puede corregirlo.`
        }
        confirmLabel="Cerrar corte"
        cancelLabel="Seguir en el corte"
        busy={busy}
        onConfirm={() => void confirmCloseCut()}
        onCancel={() => {
          if (busy) return;
          setCloseConfirmOpen(false);
          setPendingCounted(null);
        }}
      />
    </div>
  );
}
