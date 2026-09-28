import { useEffect, useMemo, useState } from "react";
import type { Store } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

type Period = "dia" | "semana" | "mes";

type Report = {
  sales: {
    id: string;
    folio: string;
    total: number;
    createdAt: string;
    employeeName: string;
    storeCode: string;
    saleType: string;
  }[];
  totals: { salesCount: number; lotsSold: number; revenue: number };
};

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

export function ReportsPage() {
  const { isAdmin, store } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [period, setPeriod] = useState<Period>("dia");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    if (isAdmin) void api<Store[]>("/stores").then(setStores);
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const range = periodRange(period, new Date());
        const params = new URLSearchParams(range);
        const activeStore = isAdmin ? storeId : store?.id;
        if (activeStore) params.set("storeId", activeStore);
        const data = await api<Report>(`/reports/sales?${params}`);
        if (!cancelled) setReport(data);
      } catch (err) {
        if (!cancelled) {
          setReport(null);
          setError(err instanceof ApiError ? err.message : "Error");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, period, store?.id, storeId]);

  const selectedStore = stores.find((item) => item.id === storeId);
  const storeLabel = isAdmin
    ? selectedStore?.name.replace("La Casa del Shampoo — ", "") ?? "todas las sucursales"
    : store?.name.replace("La Casa del Shampoo — ", "") ?? "tu sucursal";

  return (
    <div>
      <h1 className="page-title">Reportes</h1>
      <p className="page-sub">
        Hoy es {todayLabel}. Ventas de {storeLabel}.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="catalog-toolbar">
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

      {report && (
        <>
          <div className="stats">
            <div className="stat">
              Ventas
              <strong>{report.totals.salesCount}</strong>
            </div>
            <div className="stat">
              Lotes vendidos
              <strong>{report.totals.lotsSold}</strong>
            </div>
            <div className="stat">
              Ingresos
              <strong>${report.totals.revenue.toFixed(2)}</strong>
            </div>
          </div>

          {period === "dia" ? (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Fecha</th>
                    <th>Sucursal</th>
                    <th>Cajero</th>
                    <th>Tipo</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sales.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Sin ventas este día.</td>
                    </tr>
                  ) : (
                    report.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{sale.folio}</td>
                        <td>{new Date(sale.createdAt).toLocaleString("es-MX")}</td>
                        <td>{sale.storeCode}</td>
                        <td>{sale.employeeName}</td>
                        <td>{sale.saleType}</td>
                        <td>${sale.total.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>Total del día</td>
                    <td>${report.totals.revenue.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="panel">
              <p className="page-sub" style={{ marginTop: 0 }}>
                Reporte general {period === "semana" ? "de la semana" : "del mes"}, sin
                el listado de cada venta.
              </p>
              <p className="report-total">
                Total: ${report.totals.revenue.toFixed(2)}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
