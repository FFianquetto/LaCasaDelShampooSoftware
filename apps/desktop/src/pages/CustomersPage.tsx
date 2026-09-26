import { FormEvent, useEffect, useState } from "react";
import type { Customer, CustomerCategory } from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS } from "@lcds/shared";
import { api, ApiError } from "../api";

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setCustomers(await api<Customer[]>("/customers"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/customers", {
        method: "POST",
        body: JSON.stringify({ name, category, phone: phone || undefined }),
      });
      setName("");
      setPhone("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  return (
    <div>
      <h1 className="page-title">Clientes</h1>
      <p className="page-sub">
        Categorías de cliente (contrato + Excel): Local (Público), Distribuidor
        Local, Distribuidor Foráneo y Reparto.
      </p>
      {error && <div className="error">{error}</div>}
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
          <button className="btn" type="submit">
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
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{CUSTOMER_CATEGORY_LABELS[c.category]}</td>
                <td>{c.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
