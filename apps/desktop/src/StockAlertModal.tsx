import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth/AuthContext";

type StockAlert = {
  id: string;
  code: string | null;
  name: string;
  brand: string | null;
  category: string;
  disponible: number;
  minimum: number;
  message: string;
};

type StockAlertResponse = {
  count: number;
  alerts: StockAlert[];
  byCategory: {
    category: string;
    minimum: number;
    products: number;
    worst: number;
  }[];
};

/**
 * Al iniciar sesión como admin, si hay productos bajo el mínimo por categoría
 * muestra un modal descartable (una vez por sesión).
 */
export function StockAlertModal() {
  const { isAdmin, session } = useAuth();
  const [data, setData] = useState<StockAlertResponse | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin || !session) {
      setData(null);
      setOpen(false);
      return;
    }
    const key = `lcds_stock_alert_seen_${session.user.id}`;
    if (sessionStorage.getItem(key) === "1") return;

    let cancelled = false;
    void api<StockAlertResponse>("/reports/stock-alerts")
      .then((result) => {
        if (cancelled) return;
        setData(result);
        if (result.count > 0) setOpen(true);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, session]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function dismiss() {
    if (session) {
      sessionStorage.setItem(`lcds_stock_alert_seen_${session.user.id}`, "1");
    }
    setOpen(false);
  }

  if (!open || !data || data.count === 0) return null;

  return (
    <div
      className="modal-back stock-alert-back"
      role="presentation"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        className="modal stock-alert-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="stock-alert-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="stock-alert-header">
          <h2
            id="stock-alert-title"
            className="page-title"
            style={{ fontSize: "1.35rem", margin: 0 }}
          >
            Inventario bajo el mínimo
          </h2>
          <button
            type="button"
            className="stock-alert-close"
            aria-label="Cerrar alerta"
            onClick={dismiss}
          >
            ×
          </button>
        </div>

        <div className="stock-alert-body">
          <p className="page-sub">
            Hay {data.count} producto{data.count === 1 ? "" : "s"} por debajo del
            mínimo de su categoría. Revisa existencias por sucursal en Inventario.
          </p>

          {data.byCategory.length > 0 && (
            <div className="notice" style={{ marginBottom: "0.85rem" }}>
              {data.byCategory.map((row) => (
                <div key={row.category}>
                  <strong>{row.category}</strong>: {row.products} producto
                  {row.products === 1 ? "" : "s"} bajo el mínimo ({row.minimum}
                  ). Lo más bajo: {row.worst} pieza
                  {row.worst === 1 ? "" : "s"}.
                </div>
              ))}
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Hay</th>
                  <th>Mín.</th>
                </tr>
              </thead>
              <tbody>
                {data.alerts.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.code ? `${item.code} — ` : ""}
                      {item.name}
                    </td>
                    <td>{item.category}</td>
                    <td>
                      <span className="stock-out">{item.disponible}</span>
                    </td>
                    <td>{item.minimum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stock-alert-footer">
          <button className="btn" type="button" onClick={dismiss}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
