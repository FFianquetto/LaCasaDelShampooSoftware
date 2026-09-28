import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PRODUCT_CATEGORIES, type Product, type Store } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

type CatalogRow = Product & {
  disponible: number;
  vendido: number;
  price: number | null;
};

export function PosPage() {
  const { store, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(store?.id ?? "");
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<CatalogRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
  }, [isAdmin]);

  async function loadCatalog(activeStore?: string) {
    const params = new URLSearchParams();
    if (activeStore) params.set("storeId", activeStore);
    const data = await api<CatalogRow[]>(`/catalog?${params}`);
    setRows(data);
    setError(null);
  }

  useEffect(() => {
    const activeStore = isAdmin ? storeId : store?.id;
    void loadCatalog(activeStore).catch((err) =>
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el catálogo"),
    );
  }, [isAdmin, store?.id, storeId]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (category && row.category !== category) return false;
      if (!term) return true;
      const code = (row.code ?? "").toLowerCase();
      const name = row.name.toLowerCase();
      const brand = (row.brand ?? "").toLowerCase();
      return code.includes(term) || name.includes(term) || brand.includes(term);
    });
  }, [category, q, rows]);

  const activeStoreId = isAdmin ? storeId : store?.id;
  const selectedStore = isAdmin
    ? stores.find((item) => item.id === storeId)
    : store;
  const storeLabel = selectedStore?.name.replace("La Casa del Shampoo — ", "");

  async function removeFromCatalog() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/products/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      });
      setSelected(null);
      await loadCatalog(activeStoreId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo quitar el producto");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Inventario</h1>
      <p className="page-sub">
        {isAdmin
          ? "Catálogo general. Elige la sucursal para ver el stock de esa tienda. Haz clic en un producto para modificar su precio o quitarlo del catálogo."
          : `Stock de ${storeLabel ?? "tu sucursal"}.`}
      </p>
      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="catalog-toolbar">
          <select
            value={category}
            aria-label="Categoría"
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Todas las categorías</option>
            {PRODUCT_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input
            value={q}
            autoFocus
            placeholder="Busca producto por ID"
            onChange={(event) => setQ(event.target.value)}
          />
          {isAdmin && (
            <div className="store-buttons">
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
          )}
        </div>
      </div>

      <div className="panel table-wrap">
        <p className="page-sub" style={{ marginTop: 0 }}>
          {visible.length} productos
          {storeLabel && activeStoreId
            ? ` · stock de ${storeLabel}`
            : " · catálogo general"}
        </p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Producto</th>
              <th>Marca</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Disponibles</th>
              <th>Vendidos</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                className={isAdmin ? "row-link" : undefined}
                onClick={isAdmin ? () => setSelected(row) : undefined}
              >
                <td>{row.code ?? "—"}</td>
                <td>{row.name}</td>
                <td>{row.brand ?? "—"}</td>
                <td>{row.category ?? "—"}</td>
                <td>{row.price == null ? "—" : `$${row.price.toFixed(2)}`}</td>
                <td>{activeStoreId ? row.disponible : "—"}</td>
                <td>{activeStoreId ? row.vendido : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && selected && (
        <div className="modal-back" onClick={() => setSelected(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              {selected.code} — {selected.name}
            </h2>
            <p className="page-sub">
              {selected.brand ?? "Sin marca"} · {selected.category ?? "Sin categoría"}
            </p>
            <button
              className="btn"
              type="button"
              style={{ width: "100%", marginBottom: "0.5rem" }}
              onClick={() => navigate(`/precios?producto=${selected.id}`)}
            >
              Modificar este precio
            </button>
            <button
              className="btn danger"
              type="button"
              style={{ width: "100%" }}
              disabled={busy}
              onClick={() => void removeFromCatalog()}
            >
              {busy ? "Quitando…" : "Quitar del catálogo"}
            </button>
            <button
              className="btn secondary"
              type="button"
              style={{ width: "100%", marginTop: "0.5rem" }}
              onClick={() => setSelected(null)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
