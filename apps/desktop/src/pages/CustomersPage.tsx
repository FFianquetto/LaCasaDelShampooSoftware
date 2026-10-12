import { FormEvent, useEffect, useState } from "react";
import type { Customer, CustomerCategory, Store } from "@lcds/shared";
import {
  CUSTOMER_CATEGORY_LABELS,
  DEFAULT_PURCHASE_EVERY_DAYS,
  PURCHASE_RULE_PRESETS,
  isDistributorCategory,
  purchaseRuleLabel,
} from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { StoreName } from "../StoreName";

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

export function CustomersPage() {
  const { isAdmin, store } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [clientNumber, setClientNumber] = useState("");
  const [ruleChoice, setRuleChoice] = useState(String(DEFAULT_PURCHASE_EVERY_DAYS));
  const [customDays, setCustomDays] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editChoice, setEditChoice] = useState(String(DEFAULT_PURCHASE_EVERY_DAYS));
  const [editCustom, setEditCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeStoreId = isAdmin ? storeId : store?.id ?? "";
  const distributorForm = isAdmin && isDistributorCategory(category);

  async function loadCustomers(nextStoreId = activeStoreId) {
    const params = new URLSearchParams();
    if (nextStoreId) params.set("storeId", nextStoreId);
    setCustomers(await api<Customer[]>(`/customers?${params}`));
  }

  useEffect(() => {
    if (isAdmin) void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (activeStoreId) params.set("storeId", activeStoreId);
    void api<Customer[]>(`/customers?${params}`)
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
    if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setError("El correo no es válido");
      return;
    }
    setError(null);
    try {
      await api("/customers", {
        method: "POST",
        body: JSON.stringify({
          name,
          category,
          phone: phoneValue || undefined,
          email: emailValue || undefined,
          storeId: activeStoreId,
          ...(distributorForm
            ? {
                clientNumber: clientNumber.trim() || undefined,
                purchaseEveryDays,
              }
            : {}),
        }),
      });
      setName("");
      setPhone("");
      setEmail("");
      setClientNumber("");
      setRuleChoice(String(DEFAULT_PURCHASE_EVERY_DAYS));
      setCustomDays("");
      await loadCustomers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  function openRule(customer: Customer) {
    const days = customer.purchaseEveryDays ?? DEFAULT_PURCHASE_EVERY_DAYS;
    const preset = PURCHASE_RULE_PRESETS.some((item) => item.days === days);
    setEditing(customer);
    setEditNumber(customer.clientNumber ?? "");
    setEditChoice(preset ? String(days) : "custom");
    setEditCustom(preset ? "" : String(days));
    setError(null);
  }

  async function saveRule(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const purchaseEveryDays = daysFromChoice(editChoice, editCustom);
    if (!editNumber.trim() || purchaseEveryDays == null) {
      setError("Escribe el número y una regla de 1 a 365 días");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/customers/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          clientNumber: editNumber.trim(),
          purchaseEveryDays,
        }),
      });
      setEditing(null);
      await loadCustomers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  const selected = stores.find((item) => item.id === activeStoreId);
  const storeLabel = isAdmin
    ? selected?.name.replace("La Casa del Shampoo — ", "") ?? "todas las sucursales"
    : store?.name.replace("La Casa del Shampoo — ", "") ?? "tu sucursal";

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
      {error && <div className="error">{error}</div>}
      {isAdmin && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <div className="store-buttons" style={{ marginLeft: 0 }}>
            {stores.map((item) => {
              const active = item.id === storeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={active ? "btn" : "btn secondary"}
                  onClick={() => setStoreId(active ? "" : item.id)}
                >
                  {item.name.replace("La Casa del Shampoo — ", "")}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <form className="form-inline" onSubmit={onCreate}>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
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
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Teléfono</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Correo</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {distributorForm && (
            <>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Número de cliente</label>
                <input
                  value={clientNumber}
                  onChange={(e) => setClientNumber(e.target.value)}
                />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Regla de compra</label>
                <select
                  value={ruleChoice}
                  onChange={(e) => setRuleChoice(e.target.value)}
                >
                  {PURCHASE_RULE_PRESETS.map((item) => (
                    <option key={item.days} value={item.days}>
                      {item.label}
                    </option>
                  ))}
                  <option value="custom">Otro plazo</option>
                </select>
              </div>
              {ruleChoice === "custom" && (
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Cada cuántos días</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={customDays}
                    onChange={(e) => setCustomDays(e.target.value)}
                    required
                  />
                </div>
              )}
            </>
          )}
          <button className="btn" type="submit" disabled={!activeStoreId}>
            Alta
          </button>
        </form>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              {isAdmin && <th>Número</th>}
              <th>Nombre</th>
              <th>Categoría</th>
              {isAdmin && (
                <>
                  <th>Regla</th>
                  <th>Última compra</th>
                  <th>Frecuencia real</th>
                </>
              )}
              <th>Teléfono</th>
              <th>Correo</th>
              {isAdmin && <th>Sucursal</th>}
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const late = c.frequency?.status === "atrasado";
              return (
                <tr key={c.id} className={late ? "row-late" : undefined}>
                  {isAdmin && <td>{c.clientNumber ?? "—"}</td>}
                  <td>{c.name}</td>
                  <td>{CUSTOMER_CATEGORY_LABELS[c.category]}</td>
                  {isAdmin && (
                    <>
                      <td>
                        {c.purchaseEveryDays == null
                          ? "—"
                          : purchaseRuleLabel(c.purchaseEveryDays)}
                        {isDistributorCategory(c.category) && (
                          <button
                            className="btn secondary"
                            type="button"
                            style={{ marginLeft: "0.5rem", padding: "0.3rem 0.55rem" }}
                            onClick={() => openRule(c)}
                          >
                            Regla
                          </button>
                        )}
                      </td>
                      <td>
                        {c.frequency?.lastPurchaseAt
                          ? new Date(c.frequency.lastPurchaseAt).toLocaleDateString(
                              "es-MX",
                            )
                          : c.frequency
                            ? "Nunca"
                            : "—"}
                      </td>
                      <td>{rhythm(c)}</td>
                    </>
                  )}
                  <td>{c.phone ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                  {isAdmin && (
                    <td>
                      {stores.find((item) => item.id === c.storeId)?.code ?? "Todas"}
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
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              {editing.name}
            </h2>
            <p className="page-sub">
              Número de cliente y plazo máximo entre compras.
            </p>
            <form onSubmit={(event) => void saveRule(event)}>
              <div className="form-row">
                <label>Número de cliente</label>
                <input
                  value={editNumber}
                  onChange={(event) => setEditNumber(event.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label>Regla de compra</label>
                <select
                  value={editChoice}
                  onChange={(event) => setEditChoice(event.target.value)}
                >
                  {PURCHASE_RULE_PRESETS.map((item) => (
                    <option key={item.days} value={item.days}>
                      {item.label}
                    </option>
                  ))}
                  <option value="custom">Otro plazo</option>
                </select>
              </div>
              {editChoice === "custom" && (
                <div className="form-row">
                  <label>Cada cuántos días</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={editCustom}
                    onChange={(event) => setEditCustom(event.target.value)}
                    required
                  />
                </div>
              )}
              <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
                {busy ? "Guardando…" : "Guardar regla"}
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
    </div>
  );
}
