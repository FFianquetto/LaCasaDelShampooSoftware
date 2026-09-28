import { FormEvent, useEffect, useState } from "react";
import type { Product, Promotion, PromotionType } from "@lcds/shared";
import { api, ApiError } from "../api";

export function PromotionsPage({ embedded = false }: { embedded?: boolean }) {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<PromotionType>("PercentOff");
  const [percentOff, setPercentOff] = useState("10");
  const [buyQty, setBuyQty] = useState("2");
  const [getQty, setGetQty] = useState("1");
  const [productId, setProductId] = useState("");
  const [startsAt, setStartsAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [endsAt, setEndsAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [pr, p] = await Promise.all([
      api<Promotion[]>("/promotions"),
      api<Product[]>("/products?active=1"),
    ]);
    setPromos(pr);
    setProducts(p);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/promotions", {
        method: "POST",
        body: JSON.stringify({
          name,
          type,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt + "T23:59:59").toISOString(),
          percentOff: type === "PercentOff" ? Number(percentOff) : undefined,
          buyQty: type === "BuyXGetY" ? Number(buyQty) : undefined,
          getQty: type === "BuyXGetY" ? Number(getQty) : undefined,
          productId: productId || undefined,
          active: true,
        }),
      });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  async function toggle(id: string, active: boolean) {
    await api(`/promotions/${id}/active`, {
      method: "PATCH",
      body: JSON.stringify({ active: !active }),
    });
    await load();
  }

  return (
    <div>
      {embedded ? (
        <h2 className="page-title" style={{ fontSize: "1.35rem", marginTop: "1.5rem" }}>
          Promociones
        </h2>
      ) : (
        <h1 className="page-title">Promociones</h1>
      )}
      <p className="page-sub">% de descuento o compra X lleva Y, por producto y periodo.</p>
      {error && <div className="error">{error}</div>}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <form onSubmit={onCreate}>
          <div className="form-inline">
            <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
              <label>Nombre</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Tipo</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as PromotionType)}
              >
                <option value="PercentOff">% descuento</option>
                <option value="BuyXGetY">Buy X Get Y</option>
              </select>
            </div>
            {type === "PercentOff" ? (
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>%</label>
                <input
                  type="number"
                  value={percentOff}
                  onChange={(e) => setPercentOff(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Compra</label>
                  <input
                    type="number"
                    value={buyQty}
                    onChange={(e) => setBuyQty(e.target.value)}
                  />
                </div>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Gratis</label>
                  <input
                    type="number"
                    value={getQty}
                    onChange={(e) => setGetQty(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Producto (opcional)</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">Todos</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Desde</label>
              <input
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Hasta</label>
              <input
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
            <button className="btn" type="submit">
              Crear
            </button>
          </div>
        </form>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Detalle</th>
              <th>Vigencia</th>
              <th>Activa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.type}</td>
                <td>
                  {p.type === "PercentOff"
                    ? `${p.percentOff}%`
                    : `${p.buyQty}+${p.getQty}`}
                </td>
                <td>
                  {new Date(p.startsAt).toLocaleDateString()} —{" "}
                  {new Date(p.endsAt).toLocaleDateString()}
                </td>
                <td>
                  <span className={`badge ${p.active ? "ok" : "muted"}`}>
                    {p.active ? "Sí" : "No"}
                  </span>
                </td>
                <td>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => void toggle(p.id, p.active)}
                  >
                    {p.active ? "Desactivar" : "Activar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
