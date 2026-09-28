import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  CustomerCategory,
  PriceListItem,
  Product,
  SaleType,
} from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS } from "@lcds/shared";
import { api, ApiError } from "../api";
import { PromotionsPage } from "./PromotionsPage";

export function PricesPage() {
  const [params] = useSearchParams();
  const requestedId = params.get("producto") ?? "";
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<PriceListItem[]>([]);
  const [productId, setProductId] = useState(requestedId);
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [saleType, setSaleType] = useState<SaleType>("Menudeo");
  const [price, setPrice] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const promosRef = useRef<HTMLDivElement>(null);
  const [promosVisible, setPromosVisible] = useState(false);

  async function loadProducts() {
    const p = await api<Product[]>("/products?active=1");
    setProducts(p);
    setProductId((current) => {
      if (requestedId && p.some((item) => item.id === requestedId)) return requestedId;
      return current || p[0]?.id || "";
    });
  }

  async function loadPrices(id: string) {
    if (!id) {
      setPrices([]);
      return;
    }
    setPrices(await api<PriceListItem[]>(`/prices?productId=${id}`));
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  useEffect(() => {
    const node = promosRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPromosVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void loadPrices(productId);
  }, [productId]);

  useEffect(() => {
    const match = prices.find(
      (item) =>
        item.productId === productId &&
        item.customerCategory === category &&
        item.saleType === saleType,
    );
    if (match) setPrice(String(match.price));
  }, [prices, productId, category, saleType]);

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
      await loadPrices(productId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? id;

  return (
    <div>
      <h1 className="page-title">Precios y promociones</h1>
      <p className="page-sub">
        Precio por categoría de cliente y tipo de venta. Solo administrador.
      </p>
      <div className="notice">
        En Inventario, al hacer clic en un producto puedes modificar este precio
        o quitarlo del catálogo.
      </div>
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
                  {p.code ?? p.sku} — {p.name}
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
      <div id="promociones" ref={promosRef}>
        <PromotionsPage embedded />
      </div>
      {!promosVisible && (
        <button
          className="jump-down"
          type="button"
          aria-label="Bajar a promociones"
          onClick={() =>
            promosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          ↓ Promociones
        </button>
      )}
    </div>
  );
}
