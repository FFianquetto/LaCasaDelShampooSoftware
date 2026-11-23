import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type {
  Customer,
  CustomerCategory,
  PaymentMethod,
  Product,
  Sale,
  SaleItem,
  SaleType,
  Store,
  User,
} from "@lcds/shared";
import { CUSTOMER_CATEGORY_LABELS, PAYMENT_METHOD_LABELS } from "@lcds/shared";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { StoreName } from "../StoreName";
import { DateInput } from "../DateInput";
import {
  dateToIso,
  defaultDateFrom,
  defaultDateTo,
  errMsg,
  formatDateTime,
  money,
  qs,
  shortStore,
  toInputDate,
  whatsappUrl,
} from "../util";

type HistoryEntry = Sale & {
  employeeName: string;
  customerName: string | null;
  storeName: string;
  storeCode: string;
  hqEmailed: boolean;
  ticketPhone: string | null;
  ticketChannel: "email" | "whatsapp" | "none" | null;
  items: SaleItem[];
};

type DaySummary = {
  employee: null | {
    employeeName: string;
    tickets: number;
    units: number;
    revenue: number;
    profit?: number;
    byPaymentMethod: { key: string; tickets: number; units: number; revenue: number; profit?: number }[];
    byCustomerCategory: { key: string; tickets: number; units: number; revenue: number; profit?: number }[];
    byProductCategory: { key: string; tickets: number; units: number; revenue: number; profit?: number }[];
  };
};

type HistoryResponse = {
  sales: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
};

type CatalogHit = Product & { disponible: number };

const PAGE_SIZE = 50;

export function SalesHistoryPage() {
  const { isAdmin, store } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [fUser, setFUser] = useState("");
  const [fStore, setFStore] = useState("");
  const [fCustomer, setFCustomer] = useState("");
  const [fCategory, setFCategory] = useState<"" | CustomerCategory>("");
  const [fPayment, setFPayment] = useState<"" | PaymentMethod>("");
  const [fSaleType, setFSaleType] = useState<"" | SaleType>("");
  const [fFrom, setFFrom] = useState(defaultDateFrom);
  const [fTo, setFTo] = useState(defaultDateTo);
  const [productText, setProductText] = useState("");
  const [productHits, setProductHits] = useState<CatalogHit[]>([]);
  const [productId, setProductId] = useState("");
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isAdmin) return;
    void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
    void api<User[]>("/users").then(setUsers).catch(() => setUsers([]));
    void api<Customer[]>("/customers")
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [isAdmin]);

  // Búsqueda de producto para el filtro (datalist).
  useEffect(() => {
    if (!isAdmin) return;
    if (productId) return;
    const term = productText.trim();
    if (term.length < 2) {
      setProductHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api<CatalogHit[]>(`/catalog?${qs({ q: term })}`)
        .then((rows) => {
          if (!cancelled) setProductHits(rows.slice(0, 30));
        })
        .catch(() => {
          if (!cancelled) setProductHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isAdmin, productText, productId]);

  const productLabel = (item: CatalogHit) => `${item.code ?? item.sku} — ${item.name}`;

  function onProductText(value: string) {
    setProductText(value);
    const hit = productHits.find((item) => productLabel(item) === value);
    setProductId(hit?.id ?? "");
    setOffset(0);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = qs({
        userId: isAdmin ? fUser : undefined,
        storeId: isAdmin ? fStore : undefined,
        customerId: isAdmin ? fCustomer : undefined,
        productId: isAdmin ? productId : undefined,
        customerCategory: isAdmin ? fCategory : undefined,
        paymentMethod: fPayment,
        saleType: fSaleType,
        from: dateToIso(fFrom),
        to: dateToIso(fTo, true),
        limit: PAGE_SIZE,
        offset,
      });
      const dayQuery = qs({
        userId: isAdmin ? fUser || undefined : undefined,
        storeId: isAdmin ? fStore || undefined : undefined,
        from: dateToIso(fFrom),
        to: dateToIso(fTo, true),
      });
      const loadDay = !isAdmin || Boolean(fUser);
      const [history, day] = await Promise.all([
        api<HistoryResponse>(`/sales/history?${query}`),
        loadDay
          ? api<DaySummary>(`/reports/my-day?${dayQuery}`).catch(() => null)
          : Promise.resolve(null),
      ]);
      setData(history);
      setDaySummary(day);
    } catch (err) {
      setData(null);
      setDaySummary(null);
      setError(errMsg(err, "No se pudo cargar el historial"));
    } finally {
      setLoading(false);
    }
  }, [
    isAdmin,
    fUser,
    fStore,
    fCustomer,
    productId,
    fCategory,
    fPayment,
    fSaleType,
    fFrom,
    fTo,
    offset,
  ]);

  function setTodayRange() {
    const today = toInputDate(new Date());
    setFFrom(today);
    setFTo(today);
    setOffset(0);
  }

  async function openWhatsapp(phone: string, text: string) {
    const url = whatsappUrl(phone, text);
    if (import.meta.env.TAURI_ENV_PLATFORM) {
      await openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  }

  const pageTotals = useMemo(() => {
    const sales = data?.sales ?? [];
    return {
      tickets: sales.length,
      pieces: sales.reduce((acc, sale) => acc + sale.items.length, 0),
      revenue: sales.reduce((acc, sale) => acc + sale.total, 0),
    };
  }, [data]);

  useEffect(() => {
    void load();
  }, [load]);

  function filterChange<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setOffset(0);
    };
  }

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (tickets[id] === undefined) {
      try {
        const detail = await api<{ ticketText: string }>(`/sales/${id}`);
        setTickets((current) => ({ ...current, [id]: detail.ticketText }));
      } catch {
        setTickets((current) => ({ ...current, [id]: "" }));
      }
    }
  }

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const colSpan = isAdmin ? 9 : 7;

  return (
    <div>
      <h1 className="page-title">Historial de ventas</h1>
      <p className="page-sub">
        {isAdmin ? (
          "Ventas por cuenta de empleado. Filtra por empleado y, si hace falta, por sucursal."
        ) : (
          <>
            Tus ventas (tu cuenta) en{" "}
            <StoreName name={store ? shortStore(store.name) : ""} dot />
          </>
        )}
      </p>
      {error && <div className="error">{error}</div>}

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="fields-grid-5">
          {isAdmin && (
            <>
              <div className="form-row">
                <label>Empleado</label>
                <select
                  value={fUser}
                  onChange={(e) => filterChange(setFUser)(e.target.value)}
                >
                  <option value="">Todos</option>
                  {users.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>Sucursal</label>
                <select
                  value={fStore}
                  onChange={(e) => filterChange(setFStore)(e.target.value)}
                >
                  <option value="">Todas</option>
                  {stores.map((item) => (
                    <option key={item.id} value={item.id}>
                      {shortStore(item.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>Cliente</label>
                <select
                  value={fCustomer}
                  onChange={(e) => filterChange(setFCustomer)(e.target.value)}
                >
                  <option value="">Todos</option>
                  {customers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>Categoría de cliente</label>
                <select
                  value={fCategory}
                  onChange={(e) =>
                    filterChange(setFCategory)(e.target.value as "" | CustomerCategory)
                  }
                >
                  <option value="">Todas</option>
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
                <label>Producto</label>
                <input
                  list="history-products"
                  value={productText}
                  placeholder="Código o nombre…"
                  onChange={(e) => onProductText(e.target.value)}
                />
                <datalist id="history-products">
                  {productHits.map((item) => (
                    <option key={item.id} value={productLabel(item)} />
                  ))}
                </datalist>
              </div>
            </>
          )}
          <div className="form-row">
            <label>Pago</label>
            <select
              value={fPayment}
              onChange={(e) =>
                filterChange(setFPayment)(e.target.value as "" | PaymentMethod)
              }
            >
              <option value="">Todos</option>
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((key) => (
                <option key={key} value={key}>
                  {PAYMENT_METHOD_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Tipo</label>
            <select
              value={fSaleType}
              onChange={(e) =>
                filterChange(setFSaleType)(e.target.value as "" | SaleType)
              }
            >
              <option value="">Todos</option>
              <option value="Menudeo">Menudeo</option>
              <option value="Mayoreo">Mayoreo</option>
            </select>
          </div>
          <div className="form-row">
            <label>Desde</label>
            <DateInput
              value={fFrom}
              onChange={(value) => filterChange(setFFrom)(value)}
              aria-label="Desde"
            />
          </div>
          <div className="form-row">
            <label>Hasta</label>
            <DateInput
              value={fTo}
              onChange={(value) => filterChange(setFTo)(value)}
              aria-label="Hasta"
            />
          </div>
          <button className="btn secondary" type="button" onClick={setTodayRange}>
            Hoy
          </button>
        </div>
        {!daySummary?.employee && pageTotals.tickets > 0 && (
          <p className="page-sub" style={{ margin: "0.65rem 0 0" }}>
            En esta página: {pageTotals.tickets} tickets · {pageTotals.pieces} piezas ·{" "}
            {money(pageTotals.revenue)}
          </p>
        )}
      </div>

      {daySummary?.employee && (
        <div className="panel history-summary" style={{ marginBottom: "1rem" }}>
          <h2 className="page-title" style={{ fontSize: "1.35rem", marginBottom: "0.85rem" }}>
            Resumen del periodo
            {daySummary.employee.employeeName
              ? ` · ${daySummary.employee.employeeName}`
              : ""}
          </h2>
          <div
            className="stats"
            style={{
              gridTemplateColumns:
                isAdmin && daySummary.employee.profit != null
                  ? "repeat(4, 1fr)"
                  : "repeat(3, 1fr)",
            }}
          >
            <div className="stat">
              Tickets
              <strong>{daySummary.employee.tickets}</strong>
            </div>
            <div className="stat">
              Piezas
              <strong>{daySummary.employee.units}</strong>
            </div>
            <div className="stat">
              Vendido
              <strong>{money(daySummary.employee.revenue)}</strong>
            </div>
            {isAdmin && daySummary.employee.profit != null && (
              <div className="stat">
                Utilidad
                <strong>{money(daySummary.employee.profit)}</strong>
              </div>
            )}
          </div>
          <div className="summary-breakdown">
            {daySummary.employee.byPaymentMethod.length > 0 && (
              <div>
                <h3>Por pago</h3>
                {daySummary.employee.byPaymentMethod.map((row) => (
                  <div key={row.key} className="cell-note">
                    {PAYMENT_METHOD_LABELS[row.key as PaymentMethod] ?? row.key}:{" "}
                    {money(row.revenue)}
                    {isAdmin && row.profit != null
                      ? ` · util. ${money(row.profit)}`
                      : ""}
                  </div>
                ))}
              </div>
            )}
            {daySummary.employee.byCustomerCategory.length > 0 && (
              <div>
                <h3>Por tipo de cliente</h3>
                {daySummary.employee.byCustomerCategory.map((row) => (
                  <div key={row.key} className="cell-note">
                    {CUSTOMER_CATEGORY_LABELS[row.key as CustomerCategory] ??
                      row.key}
                    : {money(row.revenue)}
                    {isAdmin && row.profit != null
                      ? ` · util. ${money(row.profit)}`
                      : ""}
                  </div>
                ))}
              </div>
            )}
            {daySummary.employee.byProductCategory.length > 0 && (
              <div>
                <h3>Por categoría de producto</h3>
                {daySummary.employee.byProductCategory.map((row) => (
                  <div key={row.key} className="cell-note">
                    {row.key}: {money(row.revenue)}
                    {isAdmin && row.profit != null
                      ? ` · util. ${money(row.profit)}`
                      : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Folio</th>
              <th>Fecha</th>
              {isAdmin && <th>Sucursal</th>}
              {isAdmin && <th>Empleado</th>}
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Pago</th>
              <th>Piezas</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.sales.length === 0 ? (
              <tr>
                <td colSpan={colSpan}>
                  {loading ? "Cargando…" : "Sin ventas con esos filtros."}
                </td>
              </tr>
            ) : (
              data.sales.map((sale) => (
                <Fragment key={sale.id}>
                  <tr
                    className="row-link"
                    onClick={() => void toggle(sale.id)}
                    title="Ver detalle"
                  >
                    <td>
                      {openId === sale.id ? "▾" : "▸"} {sale.folio}
                    </td>
                    <td>{formatDateTime(sale.createdAt)}</td>
                    {isAdmin && <td>{sale.storeCode}</td>}
                    {isAdmin && <td>{sale.employeeName}</td>}
                    <td>{sale.customerName ?? "Mostrador"}</td>
                    <td>{sale.saleType}</td>
                    <td>{sale.paymentMethod ?? "Sin método"}</td>
                    <td>{sale.items.length}</td>
                    <td>{money(sale.total)}</td>
                  </tr>
                  {openId === sale.id && (
                    <tr className="row-expand">
                      <td colSpan={colSpan}>
                        <p className="page-sub" style={{ margin: "0 0 0.6rem" }}>
                          {CUSTOMER_CATEGORY_LABELS[sale.customerCategory]} ·{" "}
                          {sale.saleType} ·{" "}
                          {sale.paymentMethod
                            ? PAYMENT_METHOD_LABELS[sale.paymentMethod]
                            : "Sin método de pago"}{" "}
                          · {sale.employeeName} · {shortStore(sale.storeName)}
                          {sale.hqEmailed ? " · avisado a oficina" : ""}
                        </p>
                        <table>
                          <thead>
                            <tr>
                              <th>Producto</th>
                              <th>Código</th>
                              <th>Precio</th>
                              <th>Descuento</th>
                              <th>Cobrado</th>
                              {isAdmin && <th>Costo</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {sale.items.map((item) => (
                              <tr key={item.id}>
                                <td>{item.productName}</td>
                                <td>{item.barcode}</td>
                                <td>{money(item.unitPrice)}</td>
                                <td>
                                  {item.discount > 0 ? `-${money(item.discount)}` : "$0.00"}
                                </td>
                                <td>{money(item.finalPrice)}</td>
                                {isAdmin && (
                                  <td>
                                    {item.unitCost == null ? "—" : money(item.unitCost)}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="report-total" style={{ fontSize: "1rem" }}>
                          Subtotal {money(sale.subtotal)} · Descuento{" "}
                          {money(sale.discountTotal)} · Total {money(sale.total)}
                        </p>
                        {tickets[sale.id] ? (
                          <pre className="ticket-preview">{tickets[sale.id]}</pre>
                        ) : null}
                        {sale.ticketPhone && tickets[sale.id] && (
                          <p style={{ margin: "0.65rem 0 0" }}>
                            <button
                              className="btn secondary"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void openWhatsapp(sale.ticketPhone!, tickets[sale.id]);
                              }}
                            >
                              Abrir WhatsApp
                            </button>
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
        <div className="form-inline" style={{ marginTop: "0.85rem", alignItems: "center" }}>
          <span className="page-sub" style={{ margin: 0, flex: 1 }}>
            {from}–{to} de {total} ventas
          </span>
          <button
            className="btn secondary"
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Anterior
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
