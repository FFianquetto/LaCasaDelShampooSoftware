import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  CustomerCategory,
  PriceCostHistory,
  PriceListItem,
  Product,
  SaleType,
} from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS } from "@lcds/shared";
import { api, ApiError } from "../api";
import { DateInput, isoToMx } from "../DateInput";
import { MoneyInput, parseMoneyInput } from "../MoneyInput";
import { defaultDateTo, money } from "../util";
import { PromotionsPage } from "./PromotionsPage";

type ViewMode = "producto" | "general" | "marca";

type OverviewRow = {
  id: string;
  code: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  cost: number | null;
  prices: {
    customerCategory: CustomerCategory;
    saleType: SaleType;
    price: number;
    margin: number | null;
  }[];
};

type Overview = {
  brands: string[];
  products: OverviewRow[];
};

function marginLabel(price: number, cost: number | null | undefined) {
  if (cost == null) return "—";
  return money(price - cost);
}

export function PricesPage() {
  const [params] = useSearchParams();
  const requestedId = params.get("producto") ?? "";
  const [view, setView] = useState<ViewMode>("producto");
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<PriceListItem[]>([]);
  const [productId, setProductId] = useState(requestedId);
  const [brand, setBrand] = useState("");
  const [q, setQ] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<PriceCostHistory[]>([]);

  const [editing, setEditing] = useState<PriceListItem | null>(null);
  const [category, setCategory] = useState<CustomerCategory>("Publico");
  const [saleType, setSaleType] = useState<SaleType>("Menudeo");
  const [price, setPrice] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(defaultDateTo);
  const [note, setNote] = useState("");

  const [costEdit, setCostEdit] = useState(false);
  const [costValue, setCostValue] = useState("");
  const [costDate, setCostDate] = useState(defaultDateTo);
  const [costNote, setCostNote] = useState("");

  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const promosRef = useRef<HTMLDivElement>(null);
  const [promosVisible, setPromosVisible] = useState(false);

  const selected = products.find((p) => p.id === productId) ?? null;
  const brands = useMemo(() => {
    const set = new Set(
      products.map((p) => p.brand).filter((b): b is string => Boolean(b)),
    );
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

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

  async function loadHistory(id: string) {
    if (!id) {
      setHistory([]);
      return;
    }
    setHistory(
      await api<PriceCostHistory[]>(
        `/prices/history?productId=${encodeURIComponent(id)}&limit=30`,
      ),
    );
  }

  async function loadOverview() {
    const qs = new URLSearchParams();
    if (view === "marca" && brand) qs.set("brand", brand);
    if (q.trim()) qs.set("q", q.trim());
    setOverview(await api<Overview>(`/prices/overview?${qs}`));
  }

  useEffect(() => {
    void loadProducts().catch((err) =>
      setError(err instanceof ApiError ? err.message : "No se pudo cargar"),
    );
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
    if (view !== "producto") return;
    void loadPrices(productId);
    void loadHistory(productId);
    if (selected) setCostValue(selected.cost == null ? "" : String(selected.cost));
  }, [view, productId, selected?.cost]);

  useEffect(() => {
    if (view === "producto") return;
    void loadOverview().catch((err) =>
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el resumen"),
    );
  }, [view, brand, q]);

  function openEdit(row: PriceListItem) {
    setEditing(row);
    setCategory(row.customerCategory);
    setSaleType(row.saleType);
    setPrice(String(row.price));
    setEffectiveDate(defaultDateTo());
    setNote("");
    setError(null);
    setSaved(null);
  }

  function closeEdit() {
    setEditing(null);
    setCategory("Publico");
    setSaleType("Menudeo");
    setPrice("");
    setNote("");
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const amount = parseMoneyInput(price);
    if (!productId || amount == null) {
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
          effectiveDate,
          note: note.trim() || undefined,
        }),
      });
      await loadPrices(productId);
      await loadHistory(productId);
      closeEdit();
      setSaved("Precio guardado con vigencia del día");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  async function onSaveCost(e: FormEvent) {
    e.preventDefault();
    if (!productId) return;
    const amount = parseMoneyInput(costValue);
    if (amount == null) {
      setError("Escribe el costo original (0 o más)");
      return;
    }
    setError(null);
    setSaved(null);
    try {
      const updated = await api<Product>("/prices/cost", {
        method: "PUT",
        body: JSON.stringify({
          productId,
          cost: amount,
          effectiveDate: costDate,
          note: costNote.trim() || undefined,
        }),
      });
      setProducts((rows) =>
        rows.map((row) => (row.id === updated.id ? updated : row)),
      );
      await loadHistory(productId);
      setCostEdit(false);
      setCostNote("");
      setSaved("Costo original actualizado");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al guardar costo");
    }
  }

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? id;

  const overviewRows = overview?.products ?? [];

  return (
    <div>
      <h1 className="page-title">Precios y promociones</h1>
      <p className="page-sub">
        Costo original del Excel + precios de venta. Cada cambio queda con
        fecha de vigencia para regular costos día a día. Utilidad = precio −
        costo.
      </p>
      {error && <div className="error">{error}</div>}
      {saved && <div className="success">{saved}</div>}

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="store-buttons" style={{ marginLeft: 0, marginBottom: "0.75rem" }}>
          {(
            [
              ["producto", "Por producto"],
              ["general", "General"],
              ["marca", "Por marca"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={view === key ? "btn" : "btn secondary"}
              onClick={() => {
                setView(key);
                setSaved(null);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "producto" && (
          <div className="form-row" style={{ marginBottom: 0, maxWidth: 420 }}>
            <label>Producto</label>
            <select
              value={productId}
              onChange={(e) => {
                setSaved(null);
                setProductId(e.target.value);
                setCostEdit(false);
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
        )}

        {view !== "producto" && (
          <div className="catalog-toolbar" style={{ flexWrap: "wrap" }}>
            {view === "marca" && (
              <div className="form-row" style={{ marginBottom: 0, minWidth: "12rem" }}>
                <label>Marca</label>
                <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                  <option value="">Todas las marcas</option>
                  {(overview?.brands.length ? overview.brands : brands).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-row" style={{ marginBottom: 0, flex: 1, minWidth: "14rem" }}>
              <label>Buscar</label>
              <input
                value={q}
                placeholder="Código, nombre o marca"
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {view === "producto" && selected && (
        <>
          <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="stat">
              Costo original
              <strong>
                {selected.cost == null ? "Sin costo" : money(selected.cost)}
              </strong>
              <span>{selected.brand ?? "Sin marca"}</span>
            </div>
            <div className="stat">
              Precios cargados
              <strong>{prices.length}</strong>
              <span>Menudeo / mayoreo por categoría</span>
            </div>
            <div className="stat">
              Cambios registrados
              <strong>{history.length}</strong>
              <span>Últimos por día de vigencia</span>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: "1rem" }}>
            <h2 className="page-title" style={{ fontSize: "1.2rem", marginTop: 0 }}>
              Costo del producto
            </h2>
            {!costEdit ? (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                <p className="page-sub" style={{ margin: 0 }}>
                  Costo actual:{" "}
                  <strong>
                    {selected.cost == null ? "no capturado" : money(selected.cost)}
                  </strong>
                  . Se usa para calcular la utilidad en reportes.
                </p>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setCostEdit(true);
                    setCostValue(selected.cost == null ? "" : String(selected.cost));
                    setCostDate(defaultDateTo());
                    setCostNote("");
                  }}
                >
                  {selected.cost == null ? "Capturar costo" : "Actualizar costo"}
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void onSaveCost(e)} className="form-inline">
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Costo</label>
                  <MoneyInput
                    value={costValue}
                    onChange={setCostValue}
                    required
                    aria-label="Costo original"
                  />
                </div>
                <div className="form-row" style={{ marginBottom: 0, minWidth: "11rem" }}>
                  <label>Vigencia</label>
                  <DateInput value={costDate} onChange={setCostDate} required />
                </div>
                <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
                  <label>Nota (opcional)</label>
                  <input
                    value={costNote}
                    maxLength={300}
                    placeholder="Ej. nuevo proveedor, ajuste del día"
                    onChange={(e) => setCostNote(e.target.value)}
                  />
                </div>
                <button className="btn" type="submit">
                  Guardar costo
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => setCostEdit(false)}
                >
                  Cancelar
                </button>
              </form>
            )}
          </div>

          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Tipo</th>
                  <th>Precio</th>
                  <th>Utilidad</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {prices.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Este producto todavía no tiene precios.</td>
                  </tr>
                ) : (
                  prices.map((p) => (
                    <tr key={p.id}>
                      <td>{productName(p.productId)}</td>
                      <td>{CUSTOMER_CATEGORY_LABELS[p.customerCategory]}</td>
                      <td>{p.saleType}</td>
                      <td>{money(p.price)}</td>
                      <td>{marginLabel(p.price, selected.cost)}</td>
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

          <div className="panel table-wrap" style={{ marginTop: "1rem" }}>
            <h2 className="page-title" style={{ fontSize: "1.2rem" }}>
              Historial por día
            </h2>
            <p className="page-sub">
              Cambios de costo y precio con su fecha de vigencia.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Vigencia</th>
                  <th>Tipo</th>
                  <th>Detalle</th>
                  <th>Antes → Ahora</th>
                  <th>Nota</th>
                  <th>Por</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      Aún no hay cambios registrados. Al guardar un precio o
                      costo quedará aquí.
                    </td>
                  </tr>
                ) : (
                  history.map((item) => (
                    <tr key={item.id}>
                      <td>{isoToMx(item.effectiveDate) || item.effectiveDate}</td>
                      <td>{item.kind === "cost" ? "Costo" : "Precio"}</td>
                      <td>
                        {item.kind === "cost"
                          ? "Costo original"
                          : `${
                              item.customerCategory
                                ? CUSTOMER_CATEGORY_LABELS[
                                    item.customerCategory as CustomerCategory
                                  ]
                                : "—"
                            } · ${item.saleType ?? ""}`}
                      </td>
                      <td>
                        {item.previousValue == null
                          ? "—"
                          : money(item.previousValue)}{" "}
                        → {money(item.newValue)}
                      </td>
                      <td>{item.note ?? "—"}</td>
                      <td>{item.employeeName ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view !== "producto" && (
        <div className="panel table-wrap">
          <h2 className="page-title" style={{ fontSize: "1.2rem" }}>
            {view === "marca"
              ? brand
                ? `Marca ${brand}`
                : "Todas las marcas"
              : "Vista general"}
          </h2>
          <p className="page-sub">
            Costo, precios de venta y utilidad estimada (precio − costo).
          </p>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Marca</th>
                <th>Costo</th>
                <th>Público menudeo</th>
                <th>Util. público</th>
                <th>Dist. menudeo</th>
                <th>Util. dist.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {overviewRows.length === 0 ? (
                <tr>
                  <td colSpan={9}>No hay productos con estos filtros.</td>
                </tr>
              ) : (
                overviewRows.map((row) => {
                  const publico = row.prices.find(
                    (p) =>
                      p.customerCategory === "Publico" && p.saleType === "Menudeo",
                  );
                  const dist = row.prices.find(
                    (p) =>
                      p.customerCategory === "Distribuidor" &&
                      p.saleType === "Menudeo",
                  );
                  return (
                    <tr key={row.id}>
                      <td>{row.code ?? "—"}</td>
                      <td>{row.name}</td>
                      <td>{row.brand ?? "—"}</td>
                      <td>{row.cost == null ? "—" : money(row.cost)}</td>
                      <td>{publico ? money(publico.price) : "—"}</td>
                      <td>
                        {publico?.margin == null ? "—" : money(publico.margin)}
                      </td>
                      <td>{dist ? money(dist.price) : "—"}</td>
                      <td>{dist?.margin == null ? "—" : money(dist.margin)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn secondary"
                          style={{ padding: "0.3rem 0.55rem" }}
                          onClick={() => {
                            setProductId(row.id);
                            setView("producto");
                          }}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

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
            {selected?.cost != null && (
              <p className="page-sub">
                Costo original: <strong>{money(selected.cost)}</strong>
                {parseMoneyInput(price) != null && (
                  <>
                    {" "}
                    · Utilidad estimada:{" "}
                    <strong>
                      {money(parseMoneyInput(price)! - selected.cost)}
                    </strong>
                  </>
                )}
              </p>
            )}
            <form onSubmit={(event) => void onSave(event)}>
              <div className="form-row">
                <label>Categoría</label>
                <select
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as CustomerCategory)
                  }
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
                  onChange={(event) =>
                    setSaleType(event.target.value as SaleType)
                  }
                >
                  <option value="Menudeo">Menudeo</option>
                  <option value="Mayoreo">Mayoreo</option>
                </select>
              </div>
              <div className="form-row">
                <label>Precio</label>
                <MoneyInput
                  value={price}
                  onChange={setPrice}
                  required
                  aria-label="Precio"
                />
              </div>
              <div className="form-row">
                <label>Vigencia (día)</label>
                <DateInput
                  value={effectiveDate}
                  onChange={setEffectiveDate}
                  required
                  aria-label="Fecha de vigencia"
                />
              </div>
              <div className="form-row">
                <label>Nota (opcional)</label>
                <input
                  value={note}
                  maxLength={300}
                  placeholder="Motivo del cambio de precio"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <button
                className="btn"
                type="submit"
                disabled={parseMoneyInput(price) == null}
                style={{ width: "100%" }}
              >
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
            promosRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
        >
          ↓ Promociones
        </button>
      )}
    </div>
  );
}
