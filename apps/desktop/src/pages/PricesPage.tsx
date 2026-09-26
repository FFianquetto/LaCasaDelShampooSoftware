import { FormEvent, useEffect, useState } from "react";
import type {
  CustomerCategory,
  PriceListItem,
  Product,
  SaleType,
} from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS } from "@lcds/shared";
import { api, ApiError } from "../api";

export function PricesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<PriceListItem[]>([]);
  const [productId, setProductId] = useState("");
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [saleType, setSaleType] = useState<SaleType>("Menudeo");
  const [price, setPrice] = useState("0");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [p, pr] = await Promise.all([
      api<Product[]>("/products"),
      api<PriceListItem[]>("/prices"),
    ]);
    setProducts(p);
    setPrices(pr);
    if (!productId && p[0]) setProductId(p[0].id);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/prices", {
        method: "PUT",
        body: JSON.stringify({
          productId,
          customerCategory: category,
          saleType,
          price: Number(price),
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? id;

  return (
    <div>
      <h1 className="page-title">Precios</h1>
      <p className="page-sub">
        Matriz categoría de cliente × menudeo/mayoreo (solo admin).
      </p>
      {error && <div className="error">{error}</div>}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <form className="form-inline" onSubmit={onSave}>
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
            <label>Tipo</label>
            <select
              value={saleType}
              onChange={(e) => setSaleType(e.target.value as SaleType)}
            >
              <option value="Menudeo">Menudeo</option>
              <option value="Mayoreo">Mayoreo</option>
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Precio</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit">
            Guardar
          </button>
        </form>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Tipo</th>
              <th>Precio</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id}>
                <td>{productName(p.productId)}</td>
                <td>{CUSTOMER_CATEGORY_LABELS[p.customerCategory]}</td>
                <td>{p.saleType}</td>
                <td>${p.price.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
