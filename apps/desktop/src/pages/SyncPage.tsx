import { useEffect, useState } from "react";
import type { Store } from "@lcds/shared";
import { api, ApiError } from "../api";

type Consolidate = {
  stores: {
    code: string;
    name: string;
    salesCount: number;
    lotsSold: number;
    revenue: number;
  }[];
  grandTotal: { salesCount: number; lotsSold: number; revenue: number };
};

export function SyncPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [importPath, setImportPath] = useState("");
  const [reportPaths, setReportPaths] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consolidated, setConsolidated] = useState<Consolidate | null>(null);
  const [config, setConfig] = useState<{ exportsDir: string } | null>(null);

  useEffect(() => {
    void api<Store[]>("/stores").then((s) => {
      setStores(s);
      if (s[0]) setStoreId(s[0].id);
    });
    void api<{ exportsDir: string }>("/config").then(setConfig);
  }, []);

  async function exportCatalog() {
    setError(null);
    try {
      const res = await api<{ file: string }>("/sync/export-catalog", {
        method: "POST",
      });
      setMessage(`Catálogo exportado: ${res.file}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  async function importCatalog() {
    setError(null);
    try {
      const res = await api<{
        products: number;
        prices: number;
        promotions: number;
      }>("/sync/import-catalog", {
        method: "POST",
        body: JSON.stringify({ filePath: importPath }),
      });
      setMessage(
        `Importados ${res.products} productos, ${res.prices} precios, ${res.promotions} promociones. Lotes/ventas locales intactos.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  async function exportReport() {
    setError(null);
    try {
      const res = await api<{ file: string }>("/sync/export-report", {
        method: "POST",
        body: JSON.stringify({
          storeId,
          from: new Date(from).toISOString(),
          to: new Date(to + "T23:59:59").toISOString(),
        }),
      });
      setMessage(`Reporte exportado: ${res.file}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  async function consolidate() {
    setError(null);
    try {
      const filePaths = reportPaths
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api<Consolidate>("/sync/consolidate", {
        method: "POST",
        body: JSON.stringify({ filePaths }),
      });
      setConsolidated(res);
      setMessage("Consolidación lista");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  return (
    <div>
      <h1 className="page-title">Sync multi-tienda</h1>
      <p className="page-sub">
        Cada PC tiene su SQLite. Sync básico por archivo `.lcds` (USB o carpeta
        compartida). No sobrescribe lotes ni ventas locales.
      </p>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      {config && (
        <p className="page-sub">Carpeta exports: {config.exportsDir}</p>
      )}

      <div className="grid-2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Catálogo (productos / precios / promos)</h3>
          <button className="btn" type="button" onClick={() => void exportCatalog()}>
            Exportar catálogo
          </button>
          <div className="form-row" style={{ marginTop: "1rem" }}>
            <label>Ruta archivo .lcds a importar</label>
            <input
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="C:\...\catalog_....lcds"
            />
          </div>
          <button
            className="btn secondary"
            type="button"
            onClick={() => void importCatalog()}
            disabled={!importPath}
          >
            Importar catálogo
          </button>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Reportes de sucursal</h3>
          <div className="form-row">
            <label>Sucursal</label>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-inline">
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
          </div>
          <button className="btn" type="button" onClick={() => void exportReport()}>
            Exportar reporte
          </button>
          <div className="form-row" style={{ marginTop: "1rem" }}>
            <label>Rutas de reportes (1–3, una por línea)</label>
            <textarea
              rows={4}
              value={reportPaths}
              onChange={(e) => setReportPaths(e.target.value)}
              placeholder={"C:\\...\\report_T1_....lcds\nC:\\...\\report_T2_....lcds"}
            />
          </div>
          <button
            className="btn accent"
            type="button"
            onClick={() => void consolidate()}
          >
            Consolidar 3 tiendas
          </button>
        </div>
      </div>

      {consolidated && (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Consolidado</h3>
          <div className="stats">
            <div className="stat">
              Ventas
              <strong>{consolidated.grandTotal.salesCount}</strong>
            </div>
            <div className="stat">
              Lotes
              <strong>{consolidated.grandTotal.lotsSold}</strong>
            </div>
            <div className="stat">
              Ingresos
              <strong>${consolidated.grandTotal.revenue.toFixed(2)}</strong>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Ventas</th>
                <th>Lotes</th>
                <th>Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {consolidated.stores.map((s) => (
                <tr key={s.code}>
                  <td>
                    {s.code} — {s.name}
                  </td>
                  <td>{s.salesCount}</td>
                  <td>{s.lotsSold}</td>
                  <td>${s.revenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
