import { FormEvent, useEffect, useState } from "react";
import type { Product } from "@lcds/shared";
import { PRODUCT_CATEGORIES } from "@lcds/shared";
import { api, ApiError } from "../api";

type CatCount = { category: string; count: number };

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<CatCount[]>([]);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [newCategory, setNewCategory] = useState<string>(PRODUCT_CATEGORIES[0]);
  const [error, setError] = useState<string | null>(null);

  async function load(nextCategory = category, nextQ = q) {
    const params = new URLSearchParams();
    if (nextCategory) params.set("category", nextCategory);
    if (nextQ) params.set("q", nextQ);
    const [p, c] = await Promise.all([
      api<Product[]>(`/products?${params}`),
      api<CatCount[]>("/products/categories"),
    ]);
    setProducts(p);
    setCats(c);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/products", {
        method: "POST",
        body: JSON.stringify({
          sku,
          name,
          brand: brand || undefined,
          category: newCategory,
        }),
      });
      setSku("");
      setName("");
      setBrand("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  return (
    <div>
      <h1 className="page-title">Productos</h1>
      <p className="page-sub">
        Catálogo completo clasificado por categorías generales (admin).
      </p>
      {error && <div className="error">{error}</div>}

      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        {cats.map((c) => (
          <button
            key={c.category}
            type="button"
            className="stat"
            style={{
              cursor: "pointer",
              borderColor: category === c.category ? "var(--brand)" : undefined,
              textAlign: "left",
            }}
            onClick={() => {
              const next = category === c.category ? "" : c.category;
              setCategory(next);
              void load(next, q);
            }}
          >
            {c.category}
            <strong>{c.count}</strong>
          </button>
        ))}
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="form-inline">
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Categoría</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Todas</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Buscar</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button
            className="btn"
            type="button"
            onClick={() => void load()}
          >
            Filtrar
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <form className="form-inline" onSubmit={onCreate}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>SKU</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)} required />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Marca</label>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Categoría</label>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
            <label>Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <button className="btn" type="submit">
            Agregar
          </button>
        </form>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Marca</th>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Costo</th>
              <th>Activo</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.category ?? "—"}</td>
                <td>{p.brand ?? "—"}</td>
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.cost != null ? `$${p.cost.toFixed(2)}` : "—"}</td>
                <td>
                  <span className={`badge ${p.active ? "ok" : "muted"}`}>
                    {p.active ? "Sí" : "No"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
