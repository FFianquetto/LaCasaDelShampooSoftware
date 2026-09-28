import { FormEvent, useEffect, useState } from "react";
import type { Customer, CustomerCategory, Store } from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

export function CustomersPage() {
  const { isAdmin, store } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeStoreId = isAdmin ? storeId : store?.id ?? "";

  useEffect(() => {
    if (isAdmin) void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
  }, [isAdmin]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeStoreId) params.set("storeId", activeStoreId);
    void api<Customer[]>(`/customers?${params}`)
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [activeStoreId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!activeStoreId) {
      setError("Elige la sucursal antes de dar de alta");
      return;
    }
    setError(null);
    try {
      await api("/customers", {
        method: "POST",
        body: JSON.stringify({
          name,
          category,
          phone: phone || undefined,
          storeId: activeStoreId,
        }),
      });
      setName("");
      setPhone("");
      const params = new URLSearchParams({ storeId: activeStoreId });
      setCustomers(await api<Customer[]>(`/customers?${params}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
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
        {isAdmin
          ? `Vista general. Elige una sucursal para ver solo sus clientes. Ahora: ${storeLabel}.`
          : `Clientes de ${storeLabel}.`}
      </p>
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
          <button className="btn" type="submit" disabled={!activeStoreId}>
            Alta
          </button>
        </form>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Teléfono</th>
              {isAdmin && <th>Sucursal</th>}
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{CUSTOMER_CATEGORY_LABELS[c.category]}</td>
                <td>{c.phone ?? "—"}</td>
                {isAdmin && (
                  <td>
                    {stores.find((item) => item.id === c.storeId)?.code ?? "Todas"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
