import { useEffect, useMemo, useState } from "react";
import type { Store } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { StoreName } from "../StoreName";

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
    paymentMethod: string | null;
  }[];
  totals: { salesCount: number; lotsSold: number; revenue: number };
  cashCut?: {
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    sinMetodo: number;
    counts: {
      efectivo: number;
      tarjeta: number;
      transferencia: number;
      sinMetodo: number;
    };
    byStore: {
      storeCode: string;
      storeName: string;
      efectivo: number;
      tarjeta: number;
      transferencia: number;
    }[];
  };
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
        Hoy es {todayLabel}. Ventas de <StoreName name={storeLabel} dot />
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

          {period === "dia" && report.cashCut && (
            <div className="panel" style={{ marginBottom: "1rem" }}>
              <h2 className="page-title" style={{ fontSize: "1.35rem" }}>
                Corte del día
              </h2>
              <p className="page-sub">
                Efectivo es lo que debe haber en caja. Tarjeta es lo que debe
                coincidir con la terminal. La transferencia está en el banco y no
                entra ni a la caja ni a la terminal.
              </p>
              <div className="stats">
                <div className="stat">
                  Efectivo en caja
                  <strong>${report.cashCut.efectivo.toFixed(2)}</strong>
                  <span>{report.cashCut.counts.efectivo} ventas</span>
                </div>
                <div className="stat">
                  Tarjeta en terminal
                  <strong>${report.cashCut.tarjeta.toFixed(2)}</strong>
                  <span>{report.cashCut.counts.tarjeta} ventas</span>
                </div>
                <div className="stat">
                  Transferencia
                  <strong>${report.cashCut.transferencia.toFixed(2)}</strong>
                  <span>{report.cashCut.counts.transferencia} ventas</span>
                </div>
              </div>
              {report.cashCut.sinMetodo > 0 && (
                <p className="notice">
                  Hay ${report.cashCut.sinMetodo.toFixed(2)} en ventas sin método de
                  pago. No se suman a la caja ni a la terminal.
                </p>
              )}
              {report.cashCut.byStore.length > 1 && (
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
                      </tr>
                    </thead>
                    <tbody>
                      {report.cashCut.byStore.map((row) => (
                        <tr key={row.storeCode}>
                          <td>
                            <StoreName
                              name={row.storeName.replace("La Casa del Shampoo — ", "")}
                            />
                          </td>
                          <td>${row.efectivo.toFixed(2)}</td>
                          <td>${row.tarjeta.toFixed(2)}</td>
                          <td>${row.transferencia.toFixed(2)}</td>
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
                {report.sales.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      {period === "dia"
                        ? "Sin ventas este día."
                        : period === "semana"
                          ? "Sin ventas esta semana."
                          : "Sin ventas este mes."}
                    </td>
                  </tr>
                ) : (
                  report.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{sale.folio}</td>
                      <td>{new Date(sale.createdAt).toLocaleString("es-MX")}</td>
                      <td>{sale.storeCode}</td>
                      <td>{sale.employeeName}</td>
                      <td>{sale.saleType}</td>
                      <td>{sale.paymentMethod ?? "Sin método"}</td>
                      <td>${sale.total.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>
                    {period === "dia"
                      ? "Total del día"
                      : period === "semana"
                        ? "Total de la semana"
                        : "Total del mes"}
                  </td>
                  <td>${report.totals.revenue.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
