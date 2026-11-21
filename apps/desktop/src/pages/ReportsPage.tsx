import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  Customer,
  CustomerCategory,
  PaymentMethod,
  Product,
  SaleType,
  Store,
  User,
} from "@lcds/shared";
import {
  CUSTOMER_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  PRODUCT_CATEGORIES,
} from "@lcds/shared";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { StoreName } from "../StoreName";
import { DateInput } from "../DateInput";
import {
  PERIOD_LABEL,
  dateToIso,
  defaultDateFrom,
  defaultDateTo,
  errMsg,
  formatDate,
  formatDateTime,
  money,
  periodRange,
  qs,
  shortStore,
  type Period,
} from "../util";

type PeriodChoice = Period | "rango";
type Tab =
  | "resumen"
  | "utilidad"
  | "productos"
  | "categorias"
  | "tipo"
  | "pago"
  | "empleados"
  | "clientes"
  | "inventario";

const TABS: { key: Tab; label: string }[] = [
  { key: "resumen", label: "Resumen de ventas" },
  { key: "utilidad", label: "Utilidad" },
  { key: "productos", label: "Por producto" },
  { key: "categorias", label: "Por categoría" },
  { key: "tipo", label: "Por tipo de cliente" },
  { key: "pago", label: "Por método de pago" },
  { key: "empleados", label: "Por empleado" },
  { key: "clientes", label: "Por cliente" },
  { key: "inventario", label: "Inventario" },
];

type ProfitSnapshot = {
  period: string;
  tickets: number;
  units: number;
  revenue: number;
  cost: number;
  profit: number;
  avgTicket: number;
  margin: number;
  unitsWithoutCost: number;
  byStore: {
    storeId: string;
    storeCode: string;
    storeName: string;
    tickets: number;
    units: number;
    revenue: number;
    cost: number;
    profit: number;
    margin: number;
  }[];
};

type ProfitReport = {
  day: ProfitSnapshot;
  month: ProfitSnapshot;
  all: ProfitSnapshot;
  missingCostProducts: {
    code: string | null;
    brand: string | null;
    name: string;
  }[];
  note: string;
};

type InventoryReport = {
  Disponible: number;
  Vendido: number;
  byStore: {
    storeId: string;
    storeCode: string;
    storeName: string;
    disponible: number;
    vendido: number;
  }[];
  products: {
    id: string;
    code: string | null;
    name: string;
    brand: string | null;
    category: string | null;
    disponible: number;
    vendido: number;
  }[];
  lowStock: {
    id: string;
    code: string | null;
    name: string;
    disponible: number;
    minimum?: number;
  }[];
  outOfStock: {
    id: string;
    code: string | null;
    name: string;
    disponible: number;
    minimum?: number;
  }[];
};

type Metrics = {
  tickets: number;
  units: number;
  revenue: number;
  cost: number;
  profit: number;
  avgTicket: number;
};

type SalesReport = {
  sales: {
    id: string;
    folio: string;
    total: number;
    createdAt: string;
    employeeName: string;
    storeCode: string;
    saleType: string;
    paymentMethod: string | null;
  }[];
  totals: {
    salesCount: number;
    lotsSold: number;
    revenue: number;
    cost?: number;
    profit?: number;
  };
  cashCut?: {
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    salesCredit: number;
    sinMetodo: number;
    counts: {
      efectivo: number;
      tarjeta: number;
      transferencia: number;
      salesCredit: number;
      sinMetodo: number;
    };
    byStore: {
      storeCode: string;
      storeName: string;
      efectivo: number;
      tarjeta: number;
      transferencia: number;
      salesCredit: number;
    }[];
  };
};

type ProductsReport = {
  products: {
    id: string;
    code: string | null;
    name: string;
    brand: string | null;
    category: string | null;
    units: number;
    revenue: number;
    avgPrice: number;
    cost: number;
    profit: number;
  }[];
  totals: {
    products: number;
    units: number;
    revenue: number;
    cost: number;
    profit: number;
  };
};

type CategoryReport = {
  categories: (Metrics & {
    customerCategory: CustomerCategory;
    mayoreo: Metrics;
    menudeo: Metrics;
  })[];
  totals: Metrics;
};

type PaymentReport = {
  methods: (Metrics & { paymentMethod: string; share: number })[];
  totals: Metrics;
};

type Breakdown = Metrics & { key: string };

type EmployeesReport = {
  employees: (Metrics & {
    userId: string;
    employeeName: string;
    storeId: string;
    mayoreo: Breakdown | null;
    menudeo: Breakdown | null;
    bySaleType: Breakdown[];
    byCustomerCategory: Breakdown[];
    byProductCategory: Breakdown[];
    byPaymentMethod: Breakdown[];
    byStore: Breakdown[];
  })[];
  totals: Metrics;
};

type CustomersReport = {
  customers: (Metrics & {
    customerId: string | null;
    customerName: string;
    clientNumber: string | null;
    customerCategory: CustomerCategory | null;
    lastPurchaseAt: string | null;
  })[];
  totals: Metrics;
};

type CatalogHit = Product & { disponible: number };

type Column<T> = {
  label: string;
  render: (row: T) => ReactNode;
  total?: ReactNode;
};

function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  expand,
  expanded,
  onToggle,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty: string;
  expand?: (row: T) => ReactNode;
  expanded?: string | null;
  onToggle?: (key: string) => void;
}) {
  const hasTotals = columns.some((column) => column.total !== undefined);
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.label}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>{empty}</td>
          </tr>
        ) : (
          rows.map((row) => {
            const key = rowKey(row);
            return (
              <Fragment key={key}>
                <tr
                  className={expand ? "row-link" : undefined}
                  onClick={expand && onToggle ? () => onToggle(key) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.label}>{column.render(row)}</td>
                  ))}
                </tr>
                {expand && expanded === key && (
                  <tr className="row-expand">
                    <td colSpan={columns.length}>{expand(row)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })
        )}
      </tbody>
      {hasTotals && rows.length > 0 && (
        <tfoot>
          <tr>
            {columns.map((column, index) => (
              <td key={column.label}>
                {column.total !== undefined ? column.total : index === 0 ? "Total" : ""}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function metricColumns<T extends Metrics>(totals?: Metrics): Column<T>[] {
  return [
    { label: "Tickets", render: (r) => r.tickets, total: totals?.tickets },
    { label: "Unidades", render: (r) => r.units, total: totals?.units },
    { label: "Ingresos", render: (r) => money(r.revenue), total: totals && money(totals.revenue) },
    { label: "Costo", render: (r) => money(r.cost), total: totals && money(totals.cost) },
    { label: "Utilidad", render: (r) => money(r.profit), total: totals && money(totals.profit) },
    {
      label: "Ticket prom.",
      render: (r) => money(r.avgTicket),
      total: totals && money(totals.avgTicket),
    },
  ];
}

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <p className="page-sub" style={{ margin: "0 0 0.35rem", fontWeight: 700 }}>
        {title}
      </p>
      <table>
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Unid.</th>
            <th>Ingresos</th>
            <th>Utilidad</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>Sin datos.</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{row.units}</td>
                <td>{money(row.revenue)}</td>
                <td>{money(row.profit)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsPage() {
  const { isAdmin, store } = useAuth();
  const [tab, setTab] = useState<Tab>("resumen");
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [storeId, setStoreId] = useState("");
  const [period, setPeriod] = useState<PeriodChoice>("dia");
  const [fromDate, setFromDate] = useState(defaultDateFrom);
  const [toDate, setToDate] = useState(defaultDateTo);
  const [fUser, setFUser] = useState("");
  const [fCustomer, setFCustomer] = useState("");
  const [fCustomerCategory, setFCustomerCategory] = useState<"" | CustomerCategory>("");
  const [fPayment, setFPayment] = useState<"" | PaymentMethod>("");
  const [fSaleType, setFSaleType] = useState<"" | SaleType>("");
  const [fProductCategory, setFProductCategory] = useState("");
  const [productText, setProductText] = useState("");
  const [productId, setProductId] = useState("");
  const [productHits, setProductHits] = useState<CatalogHit[]>([]);

  const [sortBy, setSortBy] = useState<"profit" | "units" | "revenue">("profit");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [profitFocus, setProfitFocus] = useState<"day" | "month" | "all">("day");

  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [],
  );

  useEffect(() => {
    if (!isAdmin) return;
    void api<Store[]>("/stores").then(setStores).catch(() => setStores([]));
    void api<User[]>("/users").then(setUsers).catch(() => setUsers([]));
    void api<Customer[]>("/customers").then(setCustomers).catch(() => setCustomers([]));
  }, [isAdmin]);

  useEffect(() => {
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
  }, [productText, productId]);

  const productLabel = (item: CatalogHit) => `${item.code ?? item.sku} — ${item.name}`;

  function onProductText(value: string) {
    setProductText(value);
    setProductId(productHits.find((item) => productLabel(item) === value)?.id ?? "");
  }

  const activeStore = isAdmin ? storeId : (store?.id ?? "");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      setLoading(true);
      const path: Record<Tab, string> = {
        resumen: "/reports/sales",
        utilidad: "/reports/profit",
        productos: "/reports/products",
        categorias: "/reports/by-product-category",
        tipo: "/reports/by-customer-category",
        pago: "/reports/by-payment",
        empleados: "/reports/employees",
        clientes: "/reports/customers",
        inventario: "/reports/inventory",
      };
      try {
        if (tab === "inventario") {
          const result = await api<unknown>(
            `${path.inventario}?${qs({ storeId: activeStore })}`,
          );
          if (!cancelled) setData(result);
          return;
        }
        if (tab === "utilidad") {
          const result = await api<unknown>(
            `${path.utilidad}?${qs({ storeId: activeStore, userId: fUser })}`,
          );
          if (!cancelled) setData(result);
          return;
        }
        const range =
          period === "rango"
            ? { from: dateToIso(fromDate), to: dateToIso(toDate, true) }
            : periodRange(period, new Date());
        const filters = {
          storeId: activeStore,
          userId: fUser,
          ...range,
          ...(tab === "resumen"
            ? {}
            : {
                customerId: fCustomer,
                customerCategory: fCustomerCategory,
                paymentMethod: fPayment,
                saleType: fSaleType,
                category: fProductCategory,
                productId,
              }),
        };
        const result = await api<unknown>(`${path[tab]}?${qs(filters)}`);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(errMsg(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    tab,
    period,
    fromDate,
    toDate,
    activeStore,
    fUser,
    fCustomer,
    fCustomerCategory,
    fPayment,
    fSaleType,
    fProductCategory,
    productId,
  ]);

  function changeTab(next: Tab) {
    setData(null);
    setExpanded(null);
    setTab(next);
  }

  const selectedStore = stores.find((item) => item.id === storeId);
  const selectedUser = users.find((item) => item.id === fUser);
  const storeLabel = isAdmin
    ? selectedStore
      ? shortStore(selectedStore.name)
      : "todas las sucursales"
    : store
      ? shortStore(store.name)
      : "tu sucursal";
  const accountLabel = selectedUser
    ? selectedUser.fullName
    : "todas las cuentas";

  const periodWord =
    period === "dia" ? "del día" : period === "semana" ? "de la semana" : period === "mes" ? "del mes" : "del periodo";

  const sales = tab === "resumen" ? (data as SalesReport | null) : null;
  const productsReport = tab === "productos" ? (data as ProductsReport | null) : null;
  const inventory = tab === "inventario" ? (data as InventoryReport | null) : null;
  const profit = tab === "utilidad" ? (data as ProfitReport | null) : null;
  const profitSnap =
    profit == null
      ? null
      : profitFocus === "day"
        ? profit.day
        : profitFocus === "month"
          ? profit.month
          : profit.all;
  const sortedProducts = useMemo(() => {
    const rows = productsReport?.products ?? [];
    return [...rows].sort((a, b) => b[sortBy] - a[sortBy]);
  }, [productsReport, sortBy]);

  return (
    <div>
      <h1 className="page-title">Reportes</h1>
      <p className="page-sub">
        Hoy es {todayLabel}.{" "}
        {tab === "inventario" ? (
          <>
            Inventario de <StoreName name={storeLabel} dot />
          </>
        ) : (
          <>
            {tab === "utilidad" ? "Utilidad" : "Ventas"} por cuenta (
            {accountLabel}
            ) · sucursal <StoreName name={storeLabel} dot />
          </>
        )}
      </p>
      {error && <div className="error">{error}</div>}

      <div className="report-tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? "active" : undefined}
            onClick={() => changeTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="catalog-toolbar" style={{ flexWrap: "wrap" }}>
          {tab !== "inventario" && tab !== "utilidad" && (
            <div className="store-buttons" style={{ marginLeft: 0 }}>
              {(Object.keys(PERIOD_LABEL) as Period[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={period === item ? "btn" : "btn secondary"}
                  onClick={() => setPeriod(item)}
                >
                  {PERIOD_LABEL[item]}
                </button>
              ))}
              <button
                type="button"
                className={period === "rango" ? "btn" : "btn secondary"}
                onClick={() => setPeriod("rango")}
              >
                Rango
              </button>
            </div>
          )}
          {tab !== "inventario" && tab !== "utilidad" && period === "rango" && (
            <>
              <div style={{ flex: "0 0 auto", minWidth: "11rem" }}>
                <DateInput
                  value={fromDate}
                  onChange={setFromDate}
                  aria-label="Desde"
                />
              </div>
              <div style={{ flex: "0 0 auto", minWidth: "11rem" }}>
                <DateInput
                  value={toDate}
                  onChange={setToDate}
                  aria-label="Hasta"
                />
              </div>
            </>
          )}
          {isAdmin && (
            <div className="store-buttons" style={{ marginLeft: 0 }}>
              <span className="page-sub" style={{ margin: "0 0.35rem 0 0", alignSelf: "center" }}>
                Sucursal
              </span>
              {stores.map((item) => {
                const active = item.id === storeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? "btn" : "btn secondary"}
                    onClick={() => setStoreId(active ? "" : item.id)}
                  >
                    {shortStore(item.name)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {isAdmin && tab !== "inventario" && (
          <div className="form-inline" style={{ marginTop: "0.85rem" }}>
            <div className="form-row" style={{ marginBottom: 0, minWidth: "14rem" }}>
              <label>Empleado / cuenta</label>
              <select value={fUser} onChange={(e) => setFUser(e.target.value)}>
                <option value="">Todas las cuentas</option>
                {users.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                    {item.role === "Empleado" ? "" : ` (${item.role})`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {tab !== "resumen" && tab !== "inventario" && tab !== "utilidad" && (
          <div className="form-inline" style={{ marginTop: "0.85rem" }}>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Categoría de producto</label>
              <select
                value={fProductCategory}
                onChange={(e) => setFProductCategory(e.target.value)}
              >
                <option value="">Todas</option>
                {PRODUCT_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Tipo de cliente</label>
              <select
                value={fCustomerCategory}
                onChange={(e) => setFCustomerCategory(e.target.value as "" | CustomerCategory)}
              >
                <option value="">Todos</option>
                {(Object.keys(CUSTOMER_CATEGORY_LABELS) as CustomerCategory[]).map((key) => (
                  <option key={key} value={key}>
                    {CUSTOMER_CATEGORY_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Cliente</label>
              <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)}>
                <option value="">Todos</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Pago</label>
              <select
                value={fPayment}
                onChange={(e) => setFPayment(e.target.value as "" | PaymentMethod)}
              >
                <option value="">Todos</option>
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((key) => (
                  <option key={key} value={key}>
                    {PAYMENT_METHOD_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Venta</label>
              <select
                value={fSaleType}
                onChange={(e) => setFSaleType(e.target.value as "" | SaleType)}
              >
                <option value="">Menudeo y mayoreo</option>
                <option value="Menudeo">Menudeo</option>
                <option value="Mayoreo">Mayoreo</option>
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Producto</label>
              <input
                list="report-products"
                value={productText}
                placeholder="Código o nombre"
                onChange={(e) => onProductText(e.target.value)}
              />
              <datalist id="report-products">
                {productHits.map((item) => (
                  <option key={item.id} value={productLabel(item)} />
                ))}
              </datalist>
            </div>
          </div>
        )}
      </div>

      {loading && !data && (
        <div className="panel">
          <p className="page-sub" style={{ margin: 0 }}>
            Cargando…
          </p>
        </div>
      )}

      {sales && (
        <>
          <div
            className="stats"
            style={{
              gridTemplateColumns:
                sales.totals.profit != null
                  ? "repeat(4, 1fr)"
                  : "repeat(3, 1fr)",
            }}
          >
            <div className="stat">
              Ventas
              <strong>{sales.totals.salesCount}</strong>
            </div>
            <div className="stat">
              Lotes vendidos
              <strong>{sales.totals.lotsSold}</strong>
            </div>
            <div className="stat">
              Ingresos
              <strong>{money(sales.totals.revenue)}</strong>
            </div>
            {sales.totals.profit != null && (
              <div className="stat">
                Utilidad
                <strong>{money(sales.totals.profit)}</strong>
                <span>
                  Costo {money(sales.totals.cost ?? 0)} · ver pestaña Utilidad
                </span>
              </div>
            )}
          </div>

          {sales.cashCut && (
            <div className="panel" style={{ marginBottom: "1rem" }}>
              <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
                Totales por método de pago {periodWord}
              </h2>
              <p className="page-sub">
                Resumen de ventas del periodo (no sustituye el corte de caja de
                cada cuenta). Efectivo = caja · Tarjeta = terminal ·
                Transferencia = banco · Saldo = crédito.
              </p>
              <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div className="stat">
                  Efectivo en caja
                  <strong>{money(sales.cashCut.efectivo)}</strong>
                  <span>{sales.cashCut.counts.efectivo} ventas</span>
                </div>
                <div className="stat">
                  Tarjeta en terminal
                  <strong>{money(sales.cashCut.tarjeta)}</strong>
                  <span>{sales.cashCut.counts.tarjeta} ventas</span>
                </div>
                <div className="stat">
                  Transferencia
                  <strong>{money(sales.cashCut.transferencia)}</strong>
                  <span>{sales.cashCut.counts.transferencia} ventas</span>
                </div>
                <div className="stat">
                  Saldo
                  <strong>{money(sales.cashCut.salesCredit)}</strong>
                  <span>{sales.cashCut.counts.salesCredit} ventas</span>
                </div>
              </div>
              {sales.cashCut.sinMetodo > 0 && (
                <p className="notice">
                  Hay {money(sales.cashCut.sinMetodo)} en ventas sin método de pago. No
                  se suman a la caja ni a la terminal.
                </p>
              )}
              {sales.cashCut.byStore.length > 1 && (
                <div className="table-wrap">
                  <p className="page-sub" style={{ marginTop: 0 }}>
                    El efectivo de cada sucursal se cuenta por separado.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Sucursal</th>
                        <th>Efectivo</th>
                        <th>Tarjeta</th>
                        <th>Transferencia</th>
                        <th>Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.cashCut.byStore.map((row) => (
                        <tr key={row.storeCode}>
                          <td>
                            <StoreName name={shortStore(row.storeName)} />
                          </td>
                          <td>{money(row.efectivo)}</td>
                          <td>{money(row.tarjeta)}</td>
                          <td>{money(row.transferencia)}</td>
                          <td>{money(row.salesCredit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Fecha</th>
                  <th>Sucursal</th>
                  <th>Cajero</th>
                  <th>Tipo</th>
                  <th>Pago</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.sales.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Sin ventas {periodWord}.</td>
                  </tr>
                ) : (
                  sales.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{sale.folio}</td>
                      <td>{formatDateTime(sale.createdAt)}</td>
                      <td>{sale.storeCode}</td>
                      <td>{sale.employeeName}</td>
                      <td>{sale.saleType}</td>
                      <td>{sale.paymentMethod ?? "Sin método"}</td>
                      <td>{money(sale.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>Total {periodWord}</td>
                  <td>{money(sales.totals.revenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {productsReport && (
        <>
          <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="stat">
              Unidades
              <strong>{productsReport.totals.units}</strong>
              <span>{productsReport.totals.products} productos</span>
            </div>
            <div className="stat">
              Ingresos
              <strong>{money(productsReport.totals.revenue)}</strong>
            </div>
            <div className="stat">
              Costo
              <strong>{money(productsReport.totals.cost)}</strong>
            </div>
            <div className="stat">
              Utilidad
              <strong>{money(productsReport.totals.profit)}</strong>
            </div>
          </div>
          <div className="panel table-wrap">
            <div className="store-buttons" style={{ margin: "0 0 1rem" }}>
              <span className="page-sub" style={{ margin: "0 0.4rem 0 0", alignSelf: "center" }}>
                Ordenar por
              </span>
              {(
                [
                  ["profit", "Utilidad"],
                  ["units", "Unidades"],
                  ["revenue", "Ingresos"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={sortBy === key ? "btn" : "btn secondary"}
                  onClick={() => setSortBy(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <DataTable
              rows={sortedProducts}
              rowKey={(row) => row.id}
              empty="Sin ventas de productos con estos filtros."
              columns={[
                { label: "Código", render: (r) => r.code ?? "—", total: `${productsReport.totals.products} productos` },
                { label: "Producto", render: (r) => r.name, total: "" },
                { label: "Categoría", render: (r) => r.category ?? "—", total: "" },
                { label: "Unidades", render: (r) => r.units, total: productsReport.totals.units },
                { label: "Precio prom.", render: (r) => money(r.avgPrice), total: "" },
                { label: "Ingresos", render: (r) => money(r.revenue), total: money(productsReport.totals.revenue) },
                { label: "Costo", render: (r) => money(r.cost), total: money(productsReport.totals.cost) },
                { label: "Utilidad", render: (r) => money(r.profit), total: money(productsReport.totals.profit) },
              ]}
            />
          </div>
        </>
      )}

      {tab === "categorias" && data != null && (
        <div className="panel table-wrap">
          {(() => {
            const report = data as {
              categories: (Metrics & { category: string })[];
              totals: Metrics;
            };
            return (
              <DataTable
                rows={report.categories}
                rowKey={(r) => r.category}
                empty="Sin ventas con estos filtros."
                columns={[
                  { label: "Categoría", render: (r) => r.category },
                  ...metricColumns<(typeof report.categories)[number]>(report.totals),
                ]}
              />
            );
          })()}
        </div>
      )}

      {tab === "tipo" && data != null && (
        <div className="panel table-wrap">
          {(() => {
            const report = data as CategoryReport;
            return (
              <DataTable
                rows={report.categories}
                rowKey={(r) => r.customerCategory}
                empty="Sin ventas con estos filtros."
                columns={[
                  {
                    label: "Tipo de cliente",
                    render: (r) => CUSTOMER_CATEGORY_LABELS[r.customerCategory] ?? r.customerCategory,
                  },
                  ...metricColumns<CategoryReport["categories"][number]>(report.totals),
                  {
                    label: "Menudeo",
                    render: (r) => `${money(r.menudeo.revenue)} · ${r.menudeo.units} u.`,
                  },
                  {
                    label: "Mayoreo",
                    render: (r) => `${money(r.mayoreo.revenue)} · ${r.mayoreo.units} u.`,
                  },
                ]}
              />
            );
          })()}
        </div>
      )}

      {tab === "pago" && data != null && (
        <div className="panel table-wrap">
          {(() => {
            const report = data as PaymentReport;
            return (
              <DataTable
                rows={report.methods}
                rowKey={(r) => r.paymentMethod}
                empty="Sin ventas con estos filtros."
                columns={[
                  {
                    label: "Método",
                    render: (r) =>
                      PAYMENT_METHOD_LABELS[r.paymentMethod as PaymentMethod] ?? r.paymentMethod,
                  },
                  ...metricColumns<PaymentReport["methods"][number]>(report.totals),
                  { label: "% del ingreso", render: (r) => `${r.share.toFixed(1)}%`, total: "100%" },
                ]}
              />
            );
          })()}
        </div>
      )}

      {tab === "empleados" && data != null && (
        <div className="panel table-wrap">
          {(() => {
            const report = data as EmployeesReport;
            return (
              <DataTable
                rows={report.employees}
                rowKey={(r) => r.userId}
                empty="Sin ventas con estos filtros."
                expanded={expanded}
                onToggle={(key) => setExpanded((current) => (current === key ? null : key))}
                columns={[
                  { label: "Empleado", render: (r) => r.employeeName },
                  ...metricColumns<EmployeesReport["employees"][number]>(report.totals),
                ]}
                expand={(r) => (
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <BreakdownTable title="Por sucursal" rows={r.byStore ?? []} />
                    <BreakdownTable title="Menudeo / mayoreo" rows={r.bySaleType} />
                    <BreakdownTable title="Tipo de cliente" rows={r.byCustomerCategory} />
                    <BreakdownTable title="Categoría de producto" rows={r.byProductCategory} />
                    <BreakdownTable title="Método de pago" rows={r.byPaymentMethod} />
                  </div>
                )}
              />
            );
          })()}
          <p className="page-sub" style={{ margin: "0.75rem 0 0" }}>
            Haz clic en un empleado para ver su reporte. Usa el filtro de
            sucursal si la misma persona vendió en más de una.
          </p>
        </div>
      )}

      {tab === "clientes" && data != null && (
        <div className="panel table-wrap">
          {(() => {
            const report = data as CustomersReport;
            return (
              <DataTable
                rows={report.customers}
                rowKey={(r) => r.customerId ?? "mostrador"}
                empty="Sin ventas con estos filtros."
                columns={[
                  { label: "Cliente", render: (r) => r.customerName },
                  { label: "Número", render: (r) => r.clientNumber ?? "—" },
                  {
                    label: "Tipo",
                    render: (r) =>
                      r.customerCategory ? CUSTOMER_CATEGORY_LABELS[r.customerCategory] : "—",
                  },
                  { label: "Última compra", render: (r) => formatDate(r.lastPurchaseAt) },
                  ...metricColumns<CustomersReport["customers"][number]>(report.totals),
                ]}
              />
            );
          })()}
        </div>
      )}

      {profit && (
        <>
          <p className="page-sub" style={{ marginTop: 0 }}>
            {profit.note} Costo tomado del Excel (columna COSTO).
          </p>
          <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {(
              [
                ["day", "Hoy", profit.day],
                ["month", "Este mes", profit.month],
                ["all", "General", profit.all],
              ] as const
            ).map(([key, label, snap]) => (
              <button
                key={key}
                type="button"
                className="stat"
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  border:
                    profitFocus === key
                      ? "2px solid var(--accent, #1f4d3a)"
                      : undefined,
                }}
                onClick={() => setProfitFocus(key)}
              >
                {label}
                <strong>{money(snap.profit)}</strong>
                <span>
                  Ingresos {money(snap.revenue)} · Costo {money(snap.cost)} ·{" "}
                  Margen {snap.margin.toFixed(1)}%
                </span>
              </button>
            ))}
          </div>

          {profitSnap && (
            <>
              <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div className="stat">
                  Tickets
                  <strong>{profitSnap.tickets}</strong>
                </div>
                <div className="stat">
                  Unidades
                  <strong>{profitSnap.units}</strong>
                </div>
                <div className="stat">
                  Ingresos
                  <strong>{money(profitSnap.revenue)}</strong>
                </div>
                <div className="stat">
                  Utilidad
                  <strong>{money(profitSnap.profit)}</strong>
                  <span>Costo {money(profitSnap.cost)}</span>
                </div>
              </div>

              <div className="panel table-wrap" style={{ marginBottom: "1rem" }}>
                <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
                  Por sucursal —{" "}
                  {profitFocus === "day"
                    ? "hoy"
                    : profitFocus === "month"
                      ? "este mes"
                      : "general"}
                </h2>
                <table>
                  <thead>
                    <tr>
                      <th>Sucursal</th>
                      <th>Tickets</th>
                      <th>Unidades</th>
                      <th>Ingresos</th>
                      <th>Costo</th>
                      <th>Utilidad</th>
                      <th>Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitSnap.byStore.map((row) => (
                      <tr key={row.storeId}>
                        <td>
                          {row.storeCode} — {shortStore(row.storeName)}
                        </td>
                        <td>{row.tickets}</td>
                        <td>{row.units}</td>
                        <td>{money(row.revenue)}</td>
                        <td>{money(row.cost)}</td>
                        <td>{money(row.profit)}</td>
                        <td>{row.margin.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td>{profitSnap.tickets}</td>
                      <td>{profitSnap.units}</td>
                      <td>{money(profitSnap.revenue)}</td>
                      <td>{money(profitSnap.cost)}</td>
                      <td>{money(profitSnap.profit)}</td>
                      <td>{profitSnap.margin.toFixed(1)}%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {profit.missingCostProducts.length > 0 && (
            <div className="panel table-wrap">
              <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
                Sin costo en Excel
              </h2>
              <p className="notice">
                Estos {profit.missingCostProducts.length} productos no tienen
                COSTO en el Excel; su utilidad se calcula como si el costo fuera
                $0 hasta que se capture.
              </p>
              <DataTable
                rows={profit.missingCostProducts}
                rowKey={(r) => `${r.code ?? r.name}`}
                empty="Todos los productos tienen costo."
                columns={[
                  { label: "Código", render: (r) => r.code ?? "—" },
                  { label: "Marca", render: (r) => r.brand ?? "—" },
                  { label: "Producto", render: (r) => r.name },
                ]}
              />
            </div>
          )}
        </>
      )}

      {inventory && (
        <>
          <div className="stats">
            <div className="stat">
              Disponibles
              <strong>{inventory.Disponible}</strong>
            </div>
            <div className="stat">
              Vendidos
              <strong>{inventory.Vendido}</strong>
            </div>
            <div className="stat">
              Bajo el mínimo
              <strong>{inventory.lowStock.length}</strong>
            </div>
            <div className="stat">
              Sin existencia
              <strong>{inventory.outOfStock.length}</strong>
            </div>
          </div>

          {inventory.byStore.length > 0 && (
            <div className="panel table-wrap" style={{ marginBottom: "1rem" }}>
              <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
                Por sucursal
              </h2>
              <p className="page-sub">
                El stock global es la suma de Americas, Chihuahua y Henequen.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th>Disponibles</th>
                    <th>Vendidos</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.byStore.map((row) => (
                    <tr key={row.storeId}>
                      <td>
                        {row.storeCode} — {shortStore(row.storeName)}
                      </td>
                      <td>
                        <span
                          className={
                            row.disponible > 0 ? "stock-ok" : "stock-out"
                          }
                        >
                          {row.disponible}
                        </span>
                      </td>
                      <td>{row.vendido}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {inventory.lowStock.length > 0 && (
            <div className="panel table-wrap" style={{ marginBottom: "1rem" }}>
              <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
                Bajo el mínimo por categoría
              </h2>
              <DataTable
                rows={inventory.lowStock}
                rowKey={(r) => r.id}
                empty="Ningún producto bajo el mínimo."
                columns={[
                  { label: "Código", render: (r) => r.code ?? "—" },
                  { label: "Producto", render: (r) => r.name },
                  {
                    label: "Disponibles",
                    render: (r) => (
                      <span className="stock-out">{r.disponible}</span>
                    ),
                  },
                  {
                    label: "Mínimo",
                    render: (r) => r.minimum ?? "—",
                  },
                ]}
              />
            </div>
          )}

          <div className="panel table-wrap">
            <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
              Productos
            </h2>
            <DataTable
              rows={inventory.products}
              rowKey={(r) => r.id}
              empty="Sin productos con movimiento de inventario."
              columns={[
                { label: "Código", render: (r) => r.code ?? "—" },
                { label: "Producto", render: (r) => r.name },
                { label: "Marca", render: (r) => r.brand ?? "—" },
                { label: "Categoría", render: (r) => r.category ?? "—" },
                {
                  label: "Disponibles",
                  render: (r) => (
                    <span
                      className={
                        r.disponible > 0 ? "stock-ok" : "stock-out"
                      }
                    >
                      {r.disponible}
                    </span>
                  ),
                  total: inventory.Disponible,
                },
                {
                  label: "Vendidos",
                  render: (r) => r.vendido,
                  total: inventory.Vendido,
                },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
