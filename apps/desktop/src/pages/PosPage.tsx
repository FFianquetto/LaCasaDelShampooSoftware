import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PRODUCT_CATEGORIES, type Product, type Store } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

type CatalogRow = Product & {
  disponible: number;
  vendido: number;
  price: number | null;
  tacha?: boolean;
};

type ProductReport = {
  products: {
    id: string;
    code: string | null;
    name: string;
    brand: string | null;
    units: number;
    revenue: number;
  }[];
  totals: { products: number; units: number; revenue: number };
};

type Period = "dia" | "semana" | "mes";

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function periodRange(period: Period, today: Date) {
  const to = endOfDay(today);
  const from = startOfDay(today);
  if (period === "semana") {
    const weekday = from.getDay();
    const offset = weekday === 0 ? 6 : weekday - 1;
    from.setDate(from.getDate() - offset);
  }
  if (period === "mes") from.setDate(1);
  return { from: from.toISOString(), to: to.toISOString() };
}

const PERIOD_LABEL: Record<Period, string> = {
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
};

export function PosPage() {
  const { store, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(isAdmin ? "" : (store?.id ?? ""));
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<CatalogRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [salePeriod, setSalePeriod] = useState<Period>("mes");
  const [productReport, setProductReport] = useState<ProductReport | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
  }, [isAdmin]);

  async function loadCatalog(activeStore?: string) {
    const params = new URLSearchParams();
    if (activeStore) params.set("storeId", activeStore);
    return api<CatalogRow[]>(`/catalog?${params}`);
  }

  useEffect(() => {
    let cancelled = false;
    const activeStore = isAdmin ? storeId : store?.id;
    void loadCatalog(activeStore)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "No se pudo cargar el catálogo");
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, store?.id, storeId]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const range = periodRange(salePeriod, new Date());
    const params = new URLSearchParams(range);
    if (storeId) params.set("storeId", storeId);
    void api<ProductReport>(`/reports/products?${params}`)
      .then((data) => {
        if (!cancelled) setProductReport(data);
      })
      .catch(() => {
        if (!cancelled) setProductReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, salePeriod, storeId]);

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
      setRows(await loadCatalog(activeStoreId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo quitar el producto");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Inventario</h1>
      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="catalog-toolbar">
          <div className="catalog-search-row">
            <input
              className="catalog-search"
              value={q}
              autoFocus
              placeholder="Busca producto por ID"
              onChange={(event) => setQ(event.target.value)}
            />
            {isAdmin && (
              <button
                type="button"
                className={storeId === "" ? "btn" : "btn secondary"}
                onClick={() => setStoreId("")}
              >
                Todos
              </button>
            )}
          </div>
          {isAdmin && (
            <div className="store-buttons">
              {stores.map((item) => {
                const active = item.id === storeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? "btn" : "btn secondary"}
                    onClick={() => setStoreId(item.id)}
                  >
                    {item.name.replace("La Casa del Shampoo — ", "")}
                  </button>
                );
              })}
            </div>
          )}
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
        </div>
      </div>

      <div className="panel table-wrap">
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
                className={[
                  row.tacha ? "row-tacha" : "",
                  isAdmin ? "row-link" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined}
                onClick={isAdmin ? () => setSelected(row) : undefined}
              >
                <td>{row.code ?? "—"}</td>
                <td>{row.name}</td>
                <td>{row.brand ?? "—"}</td>
                <td>{row.category ?? "—"}</td>
                <td>{row.price == null ? "—" : `$${row.price.toFixed(2)}`}</td>
                <td>{row.tacha ? "✗" : row.disponible}</td>
                <td>{row.vendido}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="panel table-wrap" style={{ marginTop: "1rem" }}>
          <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
            Reporte de venta por producto
          </h2>
          <div className="store-buttons" style={{ margin: "0 0 1rem" }}>
            {(Object.keys(PERIOD_LABEL) as Period[]).map((item) => (
              <button
                key={item}
                type="button"
                className={salePeriod === item ? "btn" : "btn secondary"}
                onClick={() => setSalePeriod(item)}
              >
                {PERIOD_LABEL[item]}
              </button>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Producto</th>
                <th>Marca</th>
                <th>Unidades</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>
              {(productReport?.products.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={5}>Sin ventas de productos en este periodo.</td>
                </tr>
              ) : (
                productReport?.products.map((row) => (
                  <tr key={row.id}>
                    <td>{row.code ?? "—"}</td>
                    <td>{row.name}</td>
                    <td>{row.brand ?? "—"}</td>
                    <td>{row.units}</td>
                    <td>${row.revenue.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {productReport && productReport.products.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    {productReport.totals.products} productos
                  </td>
                  <td>{productReport.totals.units}</td>
                  <td>${productReport.totals.revenue.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

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
