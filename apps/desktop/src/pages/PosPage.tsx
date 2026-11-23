import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PRODUCT_CATEGORIES, type Product, type Store } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ProductSelect } from "../components/ProductSelect";
import { SelectField } from "../components/SelectField";
import { formatDateTime } from "../util";

type AdjustMode = "set" | "increase" | "decrease";

type StockAdjustment = {
  id: string;
  storeCode: string;
  employeeName: string;
  previousQty: number;
  newQty: number;
  delta: number;
  reason: string;
  createdAt: string;
};

type AdjustResult = {
  adjustment: StockAdjustment | null;
  previousQty: number;
  newQty: number;
  delta: number;
  created: number;
  removed: number;
};

const ADJUST_MODE_LABEL: Record<AdjustMode, string> = {
  set: "Fijar existencia en…",
  increase: "Aumentar en…",
  decrease: "Disminuir en…",
};

type CatalogRow = Product & {
  disponible: number;
  vendido: number;
  price: number | null;
  tacha?: boolean;
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
  const [adjMode, setAdjMode] = useState<AdjustMode>("increase");
  const [adjQty, setAdjQty] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [adjMessage, setAdjMessage] = useState<string | null>(null);
  const [adjError, setAdjError] = useState<string | null>(null);
  const [stockByStore, setStockByStore] = useState<
    {
      storeId: string;
      storeCode: string;
      storeName: string;
      disponible: number;
      vendido: number;
    }[]
  >([]);
  /** Sucursal sobre la que se edita el stock (obligatoria; nunca "todas"). */
  const [editStoreId, setEditStoreId] = useState("");

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

  const selectedId = selected?.id;
  const editStore = stores.find((item) => item.id === editStoreId);
  const editStock = stockByStore.find((item) => item.storeId === editStoreId);

  async function loadAdjustments(productId: string, storeFilter: string) {
    const params = new URLSearchParams({ productId, limit: "10" });
    if (storeFilter) params.set("storeId", storeFilter);
    try {
      setAdjustments(await api<StockAdjustment[]>(`/inventory/adjustments?${params}`));
    } catch {
      setAdjustments([]);
    }
  }

  async function loadStockByStore(productId: string) {
    try {
      setStockByStore(
        await api<
          {
            storeId: string;
            storeCode: string;
            storeName: string;
            disponible: number;
            vendido: number;
          }[]
        >(`/products/${productId}/stock`),
      );
    } catch {
      setStockByStore([]);
    }
  }

  function openProduct(row: CatalogRow) {
    setSelected(row);
    setAdjQty("");
    setAdjReason("");
    setAdjMessage(null);
    setAdjError(null);
    setAdjMode("increase");
    // Si el filtro global ya es una sucursal, editar esa; si no, pedir elección.
    setEditStoreId(activeStoreId ?? "");
  }

  useEffect(() => {
    if (!isAdmin || !selectedId) {
      setAdjustments([]);
      setStockByStore([]);
      return;
    }
    void loadStockByStore(selectedId);
    void loadAdjustments(selectedId, editStoreId || "");
  }, [isAdmin, selectedId, editStoreId]);

  async function onAdjust(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!editStoreId) {
      setAdjError("Elige la sucursal donde quieres modificar el stock");
      return;
    }
    const quantity = Number(adjQty);
    if (!Number.isInteger(quantity) || quantity < 0) {
      setAdjError("La cantidad debe ser un número entero (0 o más)");
      return;
    }
    if (!adjReason.trim()) {
      setAdjError("Escribe el motivo del ajuste");
      return;
    }
    const storeLabel =
      editStore?.name.replace("La Casa del Shampoo — ", "") ?? "esta sucursal";
    const confirmed = window.confirm(
      `¿Modificar stock de ${selected.code ?? selected.name} solo en ${storeLabel}?\n\n` +
        `Existencia actual en ${storeLabel}: ${editStock?.disponible ?? 0}\n` +
        `Las demás sucursales no cambian.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setAdjError(null);
    setAdjMessage(null);
    try {
      const result = await api<AdjustResult>("/inventory/adjust", {
        method: "POST",
        body: JSON.stringify({
          productId: selected.id,
          storeId: editStoreId,
          mode: adjMode,
          quantity,
          reason: adjReason.trim(),
        }),
      });
      setAdjMessage(
        result.delta === 0
          ? `Sin cambios en ${storeLabel}: la existencia ya era ${result.newQty}.`
          : `${storeLabel}: ${result.previousQty} → ${result.newQty} (${result.delta > 0 ? "+" : ""}${result.delta}).`,
      );
      setAdjQty("");
      setAdjReason("");
      const refreshed = await loadCatalog(activeStoreId);
      setRows(refreshed);
      setSelected(refreshed.find((row) => row.id === selected.id) ?? selected);
      await loadStockByStore(selected.id);
      await loadAdjustments(selected.id, editStoreId);
    } catch (err) {
      setAdjError(err instanceof ApiError ? err.message : "No se pudo ajustar la existencia");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h1 className="page-title">Inventario</h1>
      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="filter-bar">
          <div className="filter-bar__left" style={{ flex: 1, minWidth: 0 }}>
            <ProductSelect
              className="product-select--toolbar"
              value={
                rows.find(
                  (row) =>
                    (row.code ?? "").toLowerCase() === q.trim().toLowerCase() ||
                    row.id === q.trim(),
                )?.id ?? ""
              }
              products={rows}
              placeholder="Selecciona ID y producto…"
              onChange={(productId) => {
                const hit = rows.find((row) => row.id === productId);
                if (!hit) {
                  setQ("");
                  return;
                }
                setQ(hit.code ?? hit.name);
                if (isAdmin) openProduct(hit);
              }}
            />
            <SelectField
              className="product-select--toolbar"
              label="Categoría"
              value={category}
              onChange={setCategory}
            >
              <option value="">Todas las categorías</option>
              {PRODUCT_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </SelectField>
          </div>
          {isAdmin && (
            <div className="store-buttons store-buttons--equal filter-bar__right">
              <button
                type="button"
                className={storeId === "" ? "btn" : "btn secondary"}
                onClick={() => setStoreId("")}
              >
                Todos
              </button>
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
                className={`${row.tacha ? "row-tacha" : ""}${isAdmin ? " row-link" : ""}`.trim()}
                onClick={isAdmin ? () => openProduct(row) : undefined}
              >
                <td>{row.code ?? "—"}</td>
                <td>{row.name}</td>
                <td>{row.brand ?? "—"}</td>
                <td>{row.category ?? "—"}</td>
                <td>{row.price == null ? "—" : `$${row.price.toFixed(2)}`}</td>
                <td>
                  {row.tacha ? (
                    "✗"
                  ) : (
                    <span className={row.disponible > 0 ? "stock-ok" : "stock-out"}>
                      {row.disponible}
                    </span>
                  )}
                </td>
                <td>{row.vendido}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <p className="page-sub" style={{ margin: "0.75rem 0 0" }}>
            Haz clic en un producto para ajustar el stock
            {!storeId ? " (elige la sucursal dentro del editor)" : ""}.
          </p>
        )}
      </div>

      {isAdmin && selected && (
        <div className="modal-back" onClick={() => setSelected(null)}>
          <div
            className="modal wide scroll stock-editor-modal"
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

            <div className="stock-adjust stock-adjust--wide">
              <div className="stock-editor-grid">
                <div>
                  <h3 className="detail-title" style={{ marginTop: 0 }}>
                    Stock por sucursal
                  </h3>
                  <p className="page-sub">
                    Elige la sucursal y ajusta solo ahí. El total es la suma de
                    las tres.
                  </p>
                  <div className="table-wrap" style={{ marginBottom: "0.85rem" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Sucursal</th>
                          <th>Disponibles</th>
                          <th>Vendidos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockByStore.map((item) => {
                          const active = item.storeId === editStoreId;
                          return (
                            <tr
                              key={item.storeId}
                              className={
                                active ? "row-link selected" : "row-link"
                              }
                              onClick={() => {
                                setEditStoreId(item.storeId);
                                setAdjError(null);
                                setAdjMessage(null);
                              }}
                            >
                              <td>
                                {item.storeCode} —{" "}
                                {item.storeName.replace(
                                  "La Casa del Shampoo — ",
                                  "",
                                )}
                              </td>
                              <td>
                                <span
                                  className={
                                    item.disponible > 0 ? "stock-ok" : "stock-out"
                                  }
                                >
                                  {item.disponible}
                                </span>
                              </td>
                              <td>{item.vendido}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="detail-title" style={{ marginTop: 0 }}>
                    Ajustar existencia
                  </h3>
                  {!editStoreId ? (
                    <p className="notice">
                      Haz clic en una sucursal de la tabla para editarla.
                    </p>
                  ) : (
                    <form onSubmit={(event) => void onAdjust(event)}>
                      {adjError && <div className="error">{adjError}</div>}
                      {adjMessage && <div className="success">{adjMessage}</div>}
                      <p className="page-sub">
                        Sucursal:{" "}
                        <strong>
                          {editStore?.name.replace("La Casa del Shampoo — ", "")}
                        </strong>{" "}
                        · Disponible ahora:{" "}
                        <strong>{editStock?.disponible ?? 0}</strong>
                      </p>
                      <div className="form-row">
                        <label>Tipo de ajuste</label>
                        <select
                          value={adjMode}
                          onChange={(e) =>
                            setAdjMode(e.target.value as AdjustMode)
                          }
                        >
                          {(Object.keys(ADJUST_MODE_LABEL) as AdjustMode[]).map(
                            (key) => (
                              <option key={key} value={key}>
                                {ADJUST_MODE_LABEL[key]}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                      <div className="form-row">
                        <label>Cantidad</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={adjQty}
                          onChange={(e) => setAdjQty(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-row">
                        <label>Motivo</label>
                        <input
                          value={adjReason}
                          maxLength={300}
                          placeholder="Ej. conteo físico, merma, entrada de proveedor"
                          onChange={(e) => setAdjReason(e.target.value)}
                          required
                        />
                      </div>
                      <button
                        className="btn accent"
                        type="submit"
                        style={{ width: "100%" }}
                        disabled={busy}
                      >
                        {busy
                          ? "Aplicando…"
                          : `Aplicar en ${editStore?.code ?? "sucursal"}`}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              <h3 className="detail-title">Últimos ajustes</h3>
              {adjustments.length === 0 ? (
                <p className="page-sub">Sin ajustes registrados.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Suc.</th>
                        <th>Antes → Después</th>
                        <th>Motivo</th>
                        <th>Por</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjustments.map((item) => (
                        <tr key={item.id}>
                          <td>{formatDateTime(item.createdAt)}</td>
                          <td>{item.storeCode}</td>
                          <td>
                            {item.previousQty} → {item.newQty} (
                            {item.delta > 0 ? "+" : ""}
                            {item.delta})
                          </td>
                          <td>{item.reason}</td>
                          <td>{item.employeeName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="filter-bar" style={{ marginTop: "1rem" }}>
              <button
                className="btn"
                type="button"
                onClick={() => navigate(`/precios?producto=${selected.id}`)}
              >
                Ir a precios
              </button>
              <button
                className="btn danger"
                type="button"
                disabled={busy}
                onClick={() => void removeFromCatalog()}
              >
                {busy ? "Quitando…" : "Quitar del catálogo"}
              </button>
              <button
                className="btn secondary"
                type="button"
                style={{ marginLeft: "auto" }}
                onClick={() => setSelected(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
