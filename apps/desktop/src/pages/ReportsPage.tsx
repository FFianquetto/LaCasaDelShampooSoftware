import { useEffect, useState } from "react";
import type { Store } from "@lcds/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

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

export function ReportsPage() {
  const { isAdmin, store } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(store?.id ?? "");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) void api<Store[]>("/stores").then(setStores);
  }, [isAdmin]);

  async function load() {
    setError(null);
    try {
      const params = new URLSearchParams({
        from: new Date(from).toISOString(),
        to: new Date(to + "T23:59:59").toISOString(),
      });
      if (isAdmin && storeId) params.set("storeId", storeId);
      setReport(await api<Report>(`/reports/sales?${params}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 className="page-title">Reportes</h1>
      <p className="page-sub">Ventas del periodo por sucursal.</p>
      {error && <div className="error">{error}</div>}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="form-inline">
          {isAdmin && (
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Sucursal</label>
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
              >
                <option value="">Todas (esta PC)</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Desde</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Hasta</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <button className="btn" type="button" onClick={() => void load()}>
            Actualizar
          </button>
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
                {report.sales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.folio}</td>
                    <td>{new Date(s.createdAt).toLocaleString()}</td>
                    <td>{s.storeCode}</td>
                    <td>{s.employeeName}</td>
                    <td>{s.saleType}</td>
                    <td>${s.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
