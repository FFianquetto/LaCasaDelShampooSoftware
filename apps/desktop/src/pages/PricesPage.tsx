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
  const [editing, setEditing] = useState<PriceListItem | null>(null);
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [saleType, setSaleType] = useState<SaleType>("Menudeo");
  const [price, setPrice] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
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

  function openEdit(row: PriceListItem) {
    setEditing(row);
    setCategory(row.customerCategory);
    setSaleType(row.saleType);
    setPrice(String(row.price));
    setError(null);
    setSaved(null);
  }

  function closeEdit() {
    setEditing(null);
    setCategory("Publico");
    setSaleType("Menudeo");
    setPrice("");
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const amount = Number(price);
    if (!productId || price.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      setError("Escribe un precio de 0 o más para esta combinación");
      return;
    }
    try {
      await api("/prices", {
        method: "PUT",
        body: JSON.stringify({
          productId,
          customerCategory: category,
          saleType,
          price: amount,
        }),
      });
      await loadPrices(productId);
      closeEdit();
      setSaved("Precio guardado");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? id;

  return (
    <div>
      <h1 className="page-title">Precios y promociones</h1>
      {error && <div className="error">{error}</div>}
      {saved && <div className="success">{saved}</div>}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="form-row" style={{ marginBottom: 0, maxWidth: 420 }}>
          <label>Producto</label>
          <select
            value={productId}
            onChange={(e) => {
              setSaved(null);
              setProductId(e.target.value);
            }}
          >
            {[...products]
              .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code ?? p.sku} — {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Tipo</th>
              <th>Precio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {prices.length === 0 ? (
              <tr>
                <td colSpan={5}>Este producto todavía no tiene precios.</td>
              </tr>
            ) : (
              prices.map((p) => (
                <tr key={p.id}>
                  <td>{productName(p.productId)}</td>
                  <td>{CUSTOMER_CATEGORY_LABELS[p.customerCategory]}</td>
                  <td>{p.saleType}</td>
                  <td>${p.price.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="icon-btn"
                      type="button"
                      aria-label={`Editar ${productName(p.productId)}`}
                      onClick={() => openEdit(p)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="modal-back" onClick={closeEdit}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              {productName(editing.productId)}
            </h2>
            <form onSubmit={(event) => void onSave(event)}>
              <div className="form-row">
                <label>Categoría</label>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as CustomerCategory)}
                >
                  {(Object.keys(CUSTOMER_CATEGORY_LABELS) as CustomerCategory[]).map(
                    (key) => (
                      <option key={key} value={key}>
                        {CUSTOMER_CATEGORY_LABELS[key]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="form-row">
                <label>Tipo</label>
                <select
                  value={saleType}
                  onChange={(event) => setSaleType(event.target.value as SaleType)}
                >
                  <option value="Menudeo">Menudeo</option>
                  <option value="Mayoreo">Mayoreo</option>
                </select>
              </div>
              <div className="form-row">
                <label>Precio</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  required
                />
              </div>
              <button className="btn" type="submit" disabled={price.trim() === ""} style={{ width: "100%" }}>
                Guardar
              </button>
            </form>
            <button
              className="btn secondary"
              type="button"
              style={{ width: "100%", marginTop: "0.5rem" }}
              onClick={closeEdit}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
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
