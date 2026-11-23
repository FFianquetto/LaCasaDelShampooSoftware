import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Customer,
  CustomerCategory,
  CustomerFrequency,
  Store,
} from "@lcds/shared";
import {
  CUSTOMER_CATEGORY_LABELS,
  DEFAULT_PURCHASE_EVERY_DAYS,
  PURCHASE_RULE_PRESETS,
  isDistributorCategory,
  purchaseRuleLabel,
} from "@lcds/shared";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { StoreName } from "../StoreName";
import { DateInput } from "../DateInput";
import {
  dateToIso,
  defaultDateFrom,
  defaultDateTo,
  errMsg,
  formatDate,
  formatDateTime,
  money,
  qs,
  shortStore,
} from "../util";

type Analysis = {
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

const STATUS_BADGE: Record<
  CustomerFrequency["status"],
  { className: string; label: string }
> = {
  al_dia: { className: "badge ok", label: "Al día" },
  proximo: { className: "badge warn", label: "Próximo" },
  atrasado: { className: "badge late", label: "Atrasado" },
  sin_regla: { className: "badge muted", label: "Sin regla" },
};

function FrequencyBadge({ frequency }: { frequency?: CustomerFrequency | null }) {
  if (!frequency) return <span className="badge muted">—</span>;
  const badge = STATUS_BADGE[frequency.status];
  return <span className={badge.className}>{badge.label}</span>;
}

function rhythm(customer: Customer) {
  const frequency = customer.frequency;
  if (!frequency) return "—";
  if (frequency.salesCount === 0) return "Sin compras";
  if (frequency.avgDaysBetween == null) return "1 compra";
  if (frequency.avgDaysBetween <= 0) {
    return `${frequency.salesCount} compras · el mismo día`;
  }
  return `${frequency.salesCount} compras · cada ${frequency.avgDaysBetween} días`;
}

function daysFromChoice(choice: string, custom: string): number | null {
  if (choice === "custom") {
    const days = Number(custom);
    if (!Number.isInteger(days) || days < 1 || days > 365) return null;
    return days;
  }
  const days = Number(choice);
  return Number.isInteger(days) && days >= 1 ? days : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function RuleSelect({
  choice,
  custom,
  allowNone,
  onChoice,
  onCustom,
}: {
  choice: string;
  custom: string;
  allowNone?: boolean;
  onChoice: (value: string) => void;
  onCustom: (value: string) => void;
}) {
  return (
    <>
      <div className="form-row" style={{ marginBottom: 0 }}>
        <label>Regla de compra</label>
        <select value={choice} onChange={(e) => onChoice(e.target.value)}>
          {allowNone && <option value="none">Sin regla</option>}
          {PURCHASE_RULE_PRESETS.map((item) => (
            <option key={item.days} value={item.days}>
              {item.label}
            </option>
          ))}
          <option value="custom">Otro plazo</option>
        </select>
      </div>
      {choice === "custom" && (
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Cada cuántos días</label>
          <input
            type="number"
            min={1}
            max={365}
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
            required
          />
        </div>
      )}
    </>
  );
}

export function CustomersPage() {
  const { isAdmin, store } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Alta
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [branchName, setBranchName] = useState("");
  const [clientNumber, setClientNumber] = useState("");
  const [ruleChoice, setRuleChoice] = useState(String(DEFAULT_PURCHASE_EVERY_DAYS));
  const [customDays, setCustomDays] = useState("");

  // Edición (admin)
  const [editing, setEditing] = useState<Customer | null>(null);
  const [eName, setEName] = useState("");
  const [eCategory, setECategory] = useState<CustomerCategory>("Publico");
  const [ePhone, setEPhone] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [eAddress, setEAddress] = useState("");
  const [eBranch, setEBranch] = useState("");
  const [eStoreId, setEStoreId] = useState("");
  const [eNumber, setENumber] = useState("");
  const [eChoice, setEChoice] = useState("none");
  const [eCustom, setECustom] = useState("");

  // Análisis (admin)
  const [analysisFor, setAnalysisFor] = useState<Customer | null>(null);
  const [aFrom, setAFrom] = useState(defaultDateFrom);
  const [aTo, setATo] = useState(defaultDateTo);
  const [aStore, setAStore] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeStoreId = isAdmin ? storeId : (store?.id ?? "");
  const distributorForm = isAdmin && isDistributorCategory(category);

  /** Número que asignará el backend si se deja vacío (estilo P0001 → C0001). */
  const nextNumber = useMemo(() => {
    let max = 0;
    for (const item of customers) {
      const match = item.clientNumber?.match(/^C(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `C${String(max + 1).padStart(4, "0")}`;
  }, [customers]);

  async function loadCustomers(nextStoreId = activeStoreId) {
    setCustomers(await api<Customer[]>(`/customers?${qs({ storeId: nextStoreId })}`));
  }

  useEffect(() => {
    if (isAdmin) void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    void api<Customer[]>(`/customers?${qs({ storeId: activeStoreId })}`)
      .then((rows) => {
        if (!cancelled) setCustomers(rows);
      })
      .catch(() => {
        if (!cancelled) setCustomers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStoreId]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((item) =>
      [item.name, item.clientNumber, item.phone, item.email, item.branchName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [customers, search]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!activeStoreId) {
      setError("Elige la sucursal antes de dar de alta");
      return;
    }
    const purchaseEveryDays = distributorForm
      ? daysFromChoice(ruleChoice, customDays)
      : null;
    if (distributorForm && purchaseEveryDays == null) {
      setError("La regla debe ser entre 1 y 365 días");
      return;
    }
    const phoneValue = phone.trim();
    const emailValue = email.trim();
    if (!phoneValue && !emailValue) {
      setError("Escribe el teléfono o el correo. Con uno basta.");
      return;
    }
    if (emailValue && !EMAIL_RE.test(emailValue)) {
      setError("El correo no es válido");
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const created = await api<Customer>("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          category,
          phone: phoneValue || undefined,
          email: emailValue || undefined,
          address: address.trim() || undefined,
          branchName: branchName.trim() || undefined,
          storeId: activeStoreId,
          ...(isAdmin && clientNumber.trim()
            ? { clientNumber: clientNumber.trim() }
            : {}),
          ...(distributorForm ? { purchaseEveryDays } : {}),
        }),
      });
      setName("");
      setPhone("");
      setEmail("");
      setAddress("");
      setBranchName("");
      setClientNumber("");
      setRuleChoice(String(DEFAULT_PURCHASE_EVERY_DAYS));
      setCustomDays("");
      setSuccess(
        `Cliente ${created.name} dado de alta con el número ${created.clientNumber ?? "—"}.`,
      );
      await loadCustomers();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  function openEdit(customer: Customer) {
    const days = customer.purchaseEveryDays;
    const preset =
      days != null && PURCHASE_RULE_PRESETS.some((item) => item.days === days);
    setEditing(customer);
    setEName(customer.name);
    setECategory(customer.category);
    setEPhone(customer.phone ?? "");
    setEEmail(customer.email ?? "");
    setEAddress(customer.address ?? "");
    setEBranch(customer.branchName ?? "");
    setEStoreId(customer.storeId ?? "");
    setENumber(customer.clientNumber ?? "");
    setEChoice(days == null ? "none" : preset ? String(days) : "custom");
    setECustom(days != null && !preset ? String(days) : "");
    setError(null);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const phoneValue = ePhone.trim();
    const emailValue = eEmail.trim();
    if (!eName.trim()) {
      setError("Escribe el nombre del cliente");
      return;
    }
    if (!phoneValue && !emailValue) {
      setError("Deja al menos el teléfono o el correo");
      return;
    }
    if (emailValue && !EMAIL_RE.test(emailValue)) {
      setError("El correo no es válido");
      return;
    }
    let purchaseEveryDays: number | null = null;
    if (eChoice !== "none") {
      purchaseEveryDays = daysFromChoice(eChoice, eCustom);
      if (purchaseEveryDays == null) {
        setError("La regla debe ser entre 1 y 365 días");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/customers/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: eName.trim(),
          category: eCategory,
          phone: phoneValue || null,
          email: emailValue || null,
          address: eAddress.trim() || null,
          branchName: eBranch.trim() || null,
          storeId: eStoreId || null,
          ...(eNumber.trim() ? { clientNumber: eNumber.trim() } : {}),
          purchaseEveryDays,
        }),
      });
      setEditing(null);
      setSuccess("Cliente actualizado.");
      await loadCustomers();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadAnalysis(
    customer: Customer,
    filters: { from: string; to: string; storeId: string },
  ) {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      setAnalysis(
        await api<Analysis>(
          `/customers/${customer.id}/analysis?${qs({
            storeId: filters.storeId,
            from: dateToIso(filters.from),
            to: dateToIso(filters.to, true),
          })}`,
        ),
      );
    } catch (err) {
      setAnalysis(null);
      setAnalysisError(errMsg(err, "No se pudo cargar el análisis"));
    } finally {
      setAnalysisLoading(false);
    }
  }

  function openAnalysis(customer: Customer) {
    setAnalysisFor(customer);
    setAFrom("");
    setATo("");
    setAStore("");
    setAnalysis(null);
    void loadAnalysis(customer, { from: "", to: "", storeId: "" });
  }

  const selected = stores.find((item) => item.id === activeStoreId);
  const storeLabel = isAdmin
    ? selected
      ? shortStore(selected.name)
      : "todas las sucursales"
    : store
      ? shortStore(store.name)
      : "tu sucursal";

  return (
    <div>
      <h1 className="page-title">Clientes</h1>
      <p className="page-sub">
        {isAdmin ? (
          <>
            Vista general. Elige una sucursal para ver solo sus clientes. Ahora:{" "}
            <StoreName name={storeLabel} dot />
          </>
        ) : (
          <>
            Clientes de <StoreName name={storeLabel} dot />
          </>
        )}
      </p>
      {isAdmin && (
        <p className="page-sub">
          A cada distribuidora se le da un número y una regla de compra. La regla
          es el plazo máximo entre compras: si se pasa, queda atrasada. Una vez
          al mes significa 30 días.
        </p>
      )}
      {error && !editing && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
      {isAdmin && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <div className="filter-bar">
            <div className="store-buttons store-buttons--equal" style={{ marginLeft: 0 }}>
              {stores.map((item) => {
                const active = item.id === storeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? "btn" : "btn secondary"}
                    onClick={() => setStoreId(active ? "" : item.id)}
                  >
                    {shortStore(item.name)}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={showCreate ? "btn" : "btn secondary"}
              style={{ height: "var(--control-h)" }}
              onClick={() => setShowCreate((open) => !open)}
            >
              {showCreate ? "Ocultar registro" : "Registrar cliente"}
            </button>
          </div>
        </div>
      )}
      {(!isAdmin || showCreate) && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          {!isAdmin && (
            <div className="filter-bar" style={{ marginBottom: "0.75rem" }}>
              <h2 className="page-title" style={{ fontSize: "1.15rem", margin: 0, flex: 1 }}>
                Registrar cliente
              </h2>
            </div>
          )}
          <form className="fields-grid-5" onSubmit={onCreate}>
            <div className="form-row">
              <label>Nombre</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-row">
              <label>Categoría</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as CustomerCategory)}
              >
                {(Object.keys(CUSTOMER_CATEGORY_LABELS) as CustomerCategory[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {CUSTOMER_CATEGORY_LABELS[k]}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="form-row">
              <label>Número de cliente</label>
              {isAdmin ? (
                <input
                  value={clientNumber}
                  placeholder={`Automático: ${nextNumber}`}
                  onChange={(e) => setClientNumber(e.target.value)}
                />
              ) : (
                <input value={`Automático: ${nextNumber}`} readOnly />
              )}
            </div>
            <div className="form-row">
              <label>Teléfono</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Correo</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Dirección</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Sucursal del cliente</label>
              <input
                value={branchName}
                placeholder="Nombre de su sucursal"
                onChange={(e) => setBranchName(e.target.value)}
              />
            </div>
            {distributorForm && (
              <RuleSelect
                choice={ruleChoice}
                custom={customDays}
                onChoice={setRuleChoice}
                onCustom={setCustomDays}
              />
            )}
            <button className="btn" type="submit" disabled={!activeStoreId}>
              Alta
            </button>
          </form>
          {!isAdmin && isDistributorCategory(category) && (
            <p className="page-sub" style={{ margin: "0.75rem 0 0" }}>
              La regla de compra de las distribuidoras la define un administrador
              (por defecto, una vez al mes).
            </p>
          )}
        </div>
      )}
      <div className="panel table-wrap">
        <div className="form-row" style={{ marginBottom: "0.85rem" }}>
          <input
            value={search}
            placeholder="Buscar por nombre, número, teléfono, correo…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Gastado</th>
              {isAdmin && (
                <>
                  <th>Regla</th>
                  <th>Estado</th>
                  <th>Próxima compra</th>
                  <th>Última compra</th>
                  <th>Frecuencia real</th>
                </>
              )}
              <th>Teléfono</th>
              <th>Correo</th>
              <th>Dirección</th>
              <th>Sucursal cliente</th>
              {isAdmin && <th>Tienda</th>}
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 15 : 8}>Sin clientes.</td>
              </tr>
            )}
            {visible.map((c) => {
              const freq = c.frequency;
              const late = freq?.status === "atrasado";
              return (
                <tr key={c.id} className={late ? "row-late" : undefined}>
                  <td>{c.clientNumber ?? "—"}</td>
                  <td>{c.name}</td>
                  <td>{CUSTOMER_CATEGORY_LABELS[c.category]}</td>
                  <td className="spent-cell">{money(c.totalSpent ?? 0)}</td>
                  {isAdmin && (
                    <>
                      <td>
                        {c.purchaseEveryDays == null
                          ? "—"
                          : purchaseRuleLabel(c.purchaseEveryDays)}
                      </td>
                      <td>
                        <FrequencyBadge frequency={freq} />
                        {late && freq?.daysOverdue != null && (
                          <div className="cell-note">
                            {freq.daysOverdue} {freq.daysOverdue === 1 ? "día" : "días"} de
                            atraso
                          </div>
                        )}
                      </td>
                      <td>{freq?.nextPurchaseAt ? formatDate(freq.nextPurchaseAt) : "—"}</td>
                      <td>
                        {freq?.lastPurchaseAt
                          ? formatDate(freq.lastPurchaseAt)
                          : freq
                            ? "Nunca"
                            : "—"}
                      </td>
                      <td>{rhythm(c)}</td>
                    </>
                  )}
                  <td>{c.phone ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.address ?? "—"}</td>
                  <td>{c.branchName ?? "—"}</td>
                  {isAdmin && (
                    <td>{stores.find((item) => item.id === c.storeId)?.code ?? "Todas"}</td>
                  )}
                  {isAdmin && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn secondary"
                        type="button"
                        style={{ padding: "0.3rem 0.55rem", marginRight: "0.35rem" }}
                        onClick={() => openEdit(c)}
                      >
                        Editar
                      </button>
                      <button
                        className="btn secondary"
                        type="button"
                        style={{ padding: "0.3rem 0.55rem" }}
                        onClick={() => openAnalysis(c)}
                      >
                        Análisis
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isAdmin && editing && (
        <div className="modal-back" onClick={() => setEditing(null)}>
          <div
            className="modal scroll"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              Editar cliente
            </h2>
            <p className="page-sub">
              Los cambios no afectan el historial de ventas.
            </p>
            {error && <div className="error">{error}</div>}
            <form onSubmit={(event) => void saveEdit(event)}>
              <div className="form-row">
                <label>Nombre</label>
                <input value={eName} onChange={(e) => setEName(e.target.value)} required />
              </div>
              <div className="form-row">
                <label>Categoría</label>
                <select
                  value={eCategory}
                  onChange={(e) => setECategory(e.target.value as CustomerCategory)}
                >
                  {(Object.keys(CUSTOMER_CATEGORY_LABELS) as CustomerCategory[]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {CUSTOMER_CATEGORY_LABELS[k]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="form-row">
                <label>Número de cliente</label>
                <input value={eNumber} onChange={(e) => setENumber(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Teléfono</label>
                <input value={ePhone} onChange={(e) => setEPhone(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Correo</label>
                <input
                  type="email"
                  value={eEmail}
                  onChange={(e) => setEEmail(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>Dirección</label>
                <input value={eAddress} onChange={(e) => setEAddress(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Sucursal del cliente</label>
                <input value={eBranch} onChange={(e) => setEBranch(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Tienda donde se atiende</label>
                <select value={eStoreId} onChange={(e) => setEStoreId(e.target.value)}>
                  <option value="">Todas las sucursales</option>
                  {stores.map((item) => (
                    <option key={item.id} value={item.id}>
                      {shortStore(item.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-inline" style={{ marginBottom: "0.85rem" }}>
                <RuleSelect
                  choice={eChoice}
                  custom={eCustom}
                  allowNone
                  onChoice={setEChoice}
                  onCustom={setECustom}
                />
              </div>
              <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
                {busy ? "Guardando…" : "Guardar cambios"}
              </button>
            </form>
            <button
              className="btn secondary"
              type="button"
              style={{ width: "100%", marginTop: "0.5rem" }}
              onClick={() => setEditing(null)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {isAdmin && analysisFor && (
        <div className="modal-back" onClick={() => setAnalysisFor(null)}>
          <div
            className="modal wide"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              Análisis de {analysisFor.name}
            </h2>
            <p className="page-sub">
              {analysisFor.clientNumber ?? "Sin número"} ·{" "}
              {CUSTOMER_CATEGORY_LABELS[analysisFor.category]}
              {analysis?.customer.frequency && (
                <>
                  {" "}
                  · <FrequencyBadge frequency={analysis.customer.frequency} />
                </>
              )}
            </p>
            <form
              className="form-inline"
              style={{ marginBottom: "1rem" }}
              onSubmit={(event) => {
                event.preventDefault();
                void loadAnalysis(analysisFor, { from: aFrom, to: aTo, storeId: aStore });
              }}
            >
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Desde</label>
                <DateInput
                  value={aFrom}
                  onChange={setAFrom}
                  aria-label="Desde"
                />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Hasta</label>
                <DateInput value={aTo} onChange={setATo} aria-label="Hasta" />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Sucursal</label>
                <select value={aStore} onChange={(e) => setAStore(e.target.value)}>
                  <option value="">Todas</option>
                  {stores.map((item) => (
                    <option key={item.id} value={item.id}>
                      {shortStore(item.name)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn" type="submit" disabled={analysisLoading}>
                {analysisLoading ? "Calculando…" : "Aplicar"}
              </button>
            </form>
            {analysisError && <div className="error">{analysisError}</div>}
            {analysis && (
              <>
                <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                  <div className="stat">
                    Ingresos
                    <strong>{money(analysis.summary.revenue)}</strong>
                    <span>{analysis.summary.salesCount} compras</span>
                  </div>
                  <div className="stat">
                    Utilidad
                    <strong>{money(analysis.summary.profit)}</strong>
                    <span>Costo {money(analysis.summary.cost)}</span>
                  </div>
                  <div className="stat">
                    Ticket promedio
                    <strong>{money(analysis.summary.avgTicket)}</strong>
                    <span>{analysis.summary.units} piezas</span>
                  </div>
                  <div className="stat">
                    Primera / última compra
                    <strong style={{ fontSize: "1rem" }}>
                      {formatDate(analysis.summary.firstPurchaseAt)} —{" "}
                      {formatDate(analysis.summary.lastPurchaseAt)}
                    </strong>
                  </div>
                </div>

                <h3 className="detail-title">Productos comprados</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Producto</th>
                        <th>Unidades</th>
                        <th>Ingresos</th>
                        <th>Costo</th>
                        <th>Utilidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.products.length === 0 ? (
                        <tr>
                          <td colSpan={6}>Sin compras en este periodo.</td>
                        </tr>
                      ) : (
                        analysis.products.map((item) => (
                          <tr key={item.productId}>
                            <td>{item.code ?? "—"}</td>
                            <td>{item.name}</td>
                            <td>{item.units}</td>
                            <td>{money(item.revenue)}</td>
                            <td>{money(item.cost)}</td>
                            <td>{money(item.profit)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <h3 className="detail-title">Métodos de pago</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Método</th>
                        <th>Compras</th>
                        <th>Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.paymentMethods.length === 0 ? (
                        <tr>
                          <td colSpan={3}>Sin datos.</td>
                        </tr>
                      ) : (
                        analysis.paymentMethods.map((item) => (
                          <tr key={item.paymentMethod}>
                            <td>{item.paymentMethod}</td>
                            <td>{item.salesCount}</td>
                            <td>{money(item.revenue)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <h3 className="detail-title">Historial de compras</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Folio</th>
                        <th>Fecha</th>
                        <th>Sucursal</th>
                        <th>Empleado</th>
                        <th>Tipo</th>
                        <th>Pago</th>
                        <th>Piezas</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.sales.length === 0 ? (
                        <tr>
                          <td colSpan={8}>Sin compras en este periodo.</td>
                        </tr>
                      ) : (
                        analysis.sales.map((sale) => (
                          <tr key={sale.id}>
                            <td>{sale.folio}</td>
                            <td>{formatDateTime(sale.createdAt)}</td>
                            <td>{shortStore(sale.storeName)}</td>
                            <td>{sale.employeeName}</td>
                            <td>{sale.saleType}</td>
                            <td>{sale.paymentMethod ?? "Sin método"}</td>
                            <td>{sale.units}</td>
                            <td>{money(sale.total)}</td>
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
              onClick={() => setAnalysisFor(null)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
