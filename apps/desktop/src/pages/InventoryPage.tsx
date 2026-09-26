import { FormEvent, useEffect, useState } from "react";
import type { Lot, Product, Store } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

type LotRow = Lot & { productName?: string };

export function InventoryPage() {
  const { isAdmin, store } = useAuth();
  const [lots, setLots] = useState<LotRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [storeId, setStoreId] = useState(store?.id ?? "");
  const [barcode, setBarcode] = useState("");
  const [productId, setProductId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, number>>({});

  async function load() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (isAdmin && storeId) params.set("storeId", storeId);
    const [lotsData, inv] = await Promise.all([
      api<LotRow[]>(`/lots?${params}`),
      api<Record<string, number>>(
        `/reports/inventory?storeId=${isAdmin ? storeId || store?.id : store?.id}`,
      ),
    ]);
    setLots(lotsData);
    setSummary(inv);
  }

  useEffect(() => {
    void api<Product[]>("/products?active=1").then((p) => {
      setProducts(p);
      if (p[0]) setProductId(p[0].id);
    });
    if (isAdmin) void api<Store[]>("/stores").then(setStores);
    void load().catch((e) =>
      setError(e instanceof ApiError ? e.message : "Error"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    try {
      await api("/lots", {
        method: "POST",
        body: JSON.stringify({
          barcode,
          productId,
          storeId: storeId || store?.id,
        }),
      });
      setMsg("Lote registrado");
      setBarcode("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al crear lote");
    }
  }

  return (
    <div>
      <h1 className="page-title">Inventario por lotes</h1>
      <p className="page-sub">
        Cada pieza tiene ID/código de barras. Estado: Disponible o Vendido.
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}

      <div className="stats">
        <div className="stat">
          Disponible
          <strong>{summary.Disponible ?? 0}</strong>
        </div>
        <div className="stat">
          Vendido
          <strong>{summary.Vendido ?? 0}</strong>
        </div>
        <div className="stat">
          Total lotes
          <strong>
            {(summary.Disponible ?? 0) + (summary.Vendido ?? 0)}
          </strong>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="form-inline">
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Estado</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              <option value="Disponible">Disponible</option>
              <option value="Vendido">Vendido</option>
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Buscar</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {isAdmin && (
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Sucursal</label>
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button className="btn" type="button" onClick={() => void load()}>
            Filtrar
          </button>
        </div>
      </div>

      {isAdmin && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Alta de lote</h3>
          <form className="form-inline" onSubmit={onCreate}>
            <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
              <label>Código de barras</label>
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                required
              />
            </div>
            <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
              <label>Producto</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn" type="submit">
              Registrar lote
            </button>
          </form>
        </div>
      )}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Barcode</th>
              <th>Producto</th>
              <th>Estado</th>
              <th>Alta</th>
              <th>Vendido</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id}>
                <td>{l.barcode}</td>
                <td>{l.productName}</td>
                <td>
                  <span
                    className={`badge ${l.status === "Disponible" ? "ok" : "muted"}`}
                  >
                    {l.status}
                  </span>
                </td>
                <td>{new Date(l.createdAt).toLocaleString()}</td>
                <td>
                  {l.soldAt ? new Date(l.soldAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
